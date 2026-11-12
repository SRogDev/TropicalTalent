"""Phase 3 discovery graph — the incremental LangGraph migration.

This is the new orchestrator for the live per-user agent. It replaces
the AgentExecutor as the top-level decision-maker; the AgentExecutor
survives only inside the `legacy_agent` node (greetings, compare-two-
people, named-person deep dives — the turns it already handles well).

Graph (nodes / transitions):

    START -> understand
      understand --legacy--> legacy_agent --> respond --> END
      understand --clarify--> clarify --> respond --> END
      understand --search--> search_offers --offers--> present --> respond --> END
      understand --search--> search_offers --none--> sourcing --> respond --> END

Nodes:
  understand     merge LLM intent (best effort) with deterministic local
                 extraction; decide the route (pure router, see
                 `route_after_understand`).
  clarify        at most 2 questions; runs a partial search first when
                 any signal exists, so preliminary matches show while
                 information is still being collected.
  search_offers  offer search (semantic Pinecone + structured Supabase).
  present        deterministic summary text over the offers found.
  sourcing       no-results workflow: sourcing request + pending
                 notification stub (delivery is Phase 4).
  legacy_agent   collects the existing AgentExecutor stream into state.
  respond        assembles the canonical event order (message chunks,
                 clarification, offers, sourcing_request, done).

Orchestration is separated from the provider: nodes call Gemini only
through the existing services (`extract_search_intent`,
`run_agent_streaming`); the graph itself holds no model client. State
is plain JSON-serializable data so the checkpointer (Upstash Redis,
MemorySaver fallback — same pattern as Team Search) can persist it.

What remains AgentExecutor (not migrated in this phase): the
conversational turns routed to `legacy_agent`, and the profile /
compare tools it calls. Migrating those tools into graph nodes is
Phase 4+ work, not this phase.
"""

from __future__ import annotations

import operator
from typing import Annotated, Literal, Optional

from langchain_core.messages import BaseMessage, HumanMessage
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from typing_extensions import TypedDict

from app.core.logging import get_logger
from app.services.agent_executor import _split_into_chunks, run_agent_streaming
from app.services.discovery_events import (
    clarification_event,
    done_event,
    message_event,
    offers_event,
    sourcing_request_event,
)
from app.services.discovery_requirements import (
    MAX_CLARIFICATION_ROUNDS,
    Requirements,
    clarification_questions,
    extract_requirements_local,
    is_legacy_turn,
    is_sufficient,
    summarize_offers_text,
)
from app.services.intent_extractor import extract_search_intent
from app.services.offer_search import search_offers
from app.services.sourcing_requests import (
    create_sourcing_request,
    record_pending_notification,
)

logger = get_logger("services.discovery_graph")


class DiscoveryState(TypedDict, total=False):
    """Shared state for the discovery graph (JSON-serializable only)."""

    messages: Annotated[list[BaseMessage], add_messages]
    user_id: str
    conversation_id: str
    query: str
    entity_context: str
    requirements: dict
    clarification_count: int
    clarification_questions: list
    offers: list
    partial_offers: list
    sourcing_request: dict | None
    legacy_events: list
    events: Annotated[list, operator.add]
    reply_text: str
    route: str
    status: str
    error_message: str | None
    tools_used: list
    search_log_id: str | None


# ---------------------------------------------------------------------------
# Nodes
# ---------------------------------------------------------------------------

async def understand_node(state: DiscoveryState) -> dict:
    """Extract requirements and pick the route for this turn."""
    query = state.get("query") or ""
    req = extract_requirements_local(query)
    # LLM intent is an enhancement, never a requirement: if Gemini is
    # down, local extraction alone drives the decision.
    try:
        intent = await extract_search_intent(query)
        if intent and intent.passion and not req.passion:
            req.passion = intent.passion
        if intent and intent.location_city and not req.location:
            req.location = intent.location_city
    except Exception as exc:  # noqa: BLE001
        logger.warning("Intent extraction failed, using local only", error=str(exc))
    route = "legacy" if is_legacy_turn(query) else "discovery"
    return {"requirements": req.to_dict(), "route": route, "status": "understood"}


def route_after_understand(
    state: DiscoveryState,
) -> Literal["legacy_agent", "clarify", "search_offers"]:
    """Pure router: legacy turns, clarify-when-necessary, else search."""
    if state.get("route") == "legacy":
        return "legacy_agent"
    req = Requirements.from_dict(state.get("requirements") or {})
    if state.get("clarification_count", 0) >= MAX_CLARIFICATION_ROUNDS:
        return "search_offers"
    if is_sufficient(req):
        return "search_offers"
    return "clarify"


async def clarify_node(state: DiscoveryState) -> dict:
    """Ask at most 2 targeted questions; show partial results if any."""
    req = Requirements.from_dict(state.get("requirements") or {})
    questions = clarification_questions(req)
    partial: list = []
    if req.category or req.terms or req.passion or req.location:
        try:
            partial = await search_offers(
                state.get("query") or "",
                req.to_dict(),
                state.get("user_id") or "",
                limit=3,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Partial search failed", error=str(exc))
            partial = []
    count = state.get("clarification_count", 0) + 1
    reply = (
        "Before I search, a couple of quick questions so I look in the "
        "right place — and here is what already matches, while you answer."
        if partial
        else "Before I search, a couple of quick questions so I look in the right place."
    )
    return {
        "clarification_questions": questions,
        "partial_offers": partial,
        "offers": partial,
        "clarification_count": count,
        "reply_text": reply,
        "status": "clarifying",
    }


async def search_offers_node(state: DiscoveryState) -> dict:
    """Run the offer search for the extracted requirements."""
    req = Requirements.from_dict(state.get("requirements") or {})
    try:
        offers = await search_offers(
            state.get("query") or "",
            req.to_dict(),
            state.get("user_id") or "",
            limit=6,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Offer search failed", error=str(exc))
        offers = []
    return {
        "offers": offers,
        "tools_used": ["search_offers"],
        "status": "searched",
    }


def route_after_search(
    state: DiscoveryState,
) -> Literal["present", "sourcing"]:
    """Offers found -> present them; none -> the sourcing workflow."""
    return "present" if state.get("offers") else "sourcing"


async def present_node(state: DiscoveryState) -> dict:
    """Deterministic summary over the offers actually found."""
    offers = state.get("offers") or []
    return {
        "reply_text": summarize_offers_text(offers, state.get("query") or ""),
        "status": "presented",
    }


async def sourcing_node(state: DiscoveryState) -> dict:
    """No-results workflow: structured request + pending notification."""
    req = Requirements.from_dict(state.get("requirements") or {})
    query = state.get("query") or ""
    try:
        created = await create_sourcing_request(
            user_id=state.get("user_id") or "",
            query=query,
            requirements=req.to_dict(),
            conversation_id=state.get("conversation_id"),
        )
        try:
            await record_pending_notification(
                sourcing_request_id=created.get("id") or "",
                user_id=state.get("user_id") or "",
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Pending notification record failed", error=str(exc)
            )
        reply = (
            "I couldn't find a matching offer right now, so I saved your "
            "request as a sourcing request. Cubora will look for a supplier "
            "and let you know when a real opportunity appears."
        )
        return {
            "sourcing_request": created,
            "reply_text": reply,
            "status": "sourcing_requested",
        }
    except Exception as exc:  # noqa: BLE001
        logger.error("Sourcing request creation failed", error=str(exc))
        return {
            "reply_text": summarize_offers_text([], query),
            "error_message": str(exc),
            "status": "error",
        }


async def legacy_agent_node(state: DiscoveryState) -> dict:
    """Preserved behaviour: the existing AgentExecutor answers the turn.

    Its streamed events are collected into state so `respond` can emit
    them in the same SSE shape as before.
    """
    events: list = []
    tools_used: list = []
    search_log_id = state.get("search_log_id")
    reply_parts: list = []
    try:
        async for event in run_agent_streaming(
            user_id=state.get("user_id") or "",
            message=state.get("query") or "",
            chat_history=list(state.get("messages") or []),
            entity_context=state.get("entity_context") or "",
        ):
            if event["type"] == "done":
                continue
            events.append(event)
            if event["type"] == "message":
                reply_parts.append(event["content"])
            elif event["type"] == "tool_used":
                tools_used.append(event["content"])
            elif event["type"] == "search_log":
                search_log_id = (event["content"] or {}).get("log_id")
    except Exception as exc:  # noqa: BLE001
        logger.error("Legacy agent failed", error=str(exc))
        events.append(
            message_event(
                "I'm sorry, something went wrong. Could you try rephrasing "
                "your request?"
            )
        )
    return {
        "legacy_events": events,
        "reply_text": "".join(reply_parts),
        "tools_used": tools_used,
        "search_log_id": search_log_id,
        "status": "legacy_answered",
    }


async def respond_node(state: DiscoveryState) -> dict:
    """Assemble the turn's events in canonical order.

    Discovery turn: message chunks, then clarification, then offers,
    then sourcing_request, then done. Legacy turn: the collected
    AgentExecutor events, then done.
    """
    legacy_events = state.get("legacy_events") or []
    if legacy_events:
        return {"events": [*legacy_events, done_event()], "status": "done"}

    events: list = []
    reply_text = state.get("reply_text") or ""
    if reply_text:
        chunks = _split_into_chunks(reply_text)
        for i, chunk in enumerate(chunks):
            content = chunk if i == len(chunks) - 1 else chunk + " "
            events.append(message_event(content))
    questions = state.get("clarification_questions") or []
    if questions:
        events.append(
            clarification_event(
                questions, partial_offers=state.get("partial_offers") or []
            )
        )
    offers = state.get("offers") or []
    if offers and state.get("status") != "clarifying":
        events.append(
            offers_event(offers, query=state.get("query") or "", partial=False)
        )
    elif offers and state.get("status") == "clarifying":
        # Partial offers already ride inside the clarification event;
        # emit them as an offers event too so the client renders cards.
        events.append(
            offers_event(offers, query=state.get("query") or "", partial=True)
        )
    sourcing = state.get("sourcing_request")
    if sourcing:
        events.append(sourcing_request_event(sourcing))
    events.append(done_event())
    return {"events": events, "status": "done"}


# ---------------------------------------------------------------------------
# Checkpointer (Upstash Redis -> MemorySaver, same pattern as Team Search)
# ---------------------------------------------------------------------------

def _build_checkpointer():
    """Return a Redis checkpointer (Upstash) or MemorySaver as fallback.

    The fallback is in-process only: conversation state is lost on
    restart/redeploy. That is documented, not claimed otherwise.
    """
    from app.core.config import get_settings  # noqa: PLC0415

    settings = get_settings()
    url = getattr(settings, "upstash_redis_url", None)
    if url:
        try:
            from langgraph.checkpoint.redis import RedisSaver  # noqa: PLC0415

            checkpointer = RedisSaver.from_conn_string(url)
            checkpointer.setup()
            logger.info("Discovery checkpointer: Upstash Redis")
            return checkpointer
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Upstash Redis unavailable — falling back to MemorySaver",
                error=str(exc),
            )
    from langgraph.checkpoint.memory import MemorySaver  # noqa: PLC0415

    logger.info("Discovery checkpointer: MemorySaver (in-process only)")
    return MemorySaver()


# ---------------------------------------------------------------------------
# Graph construction (singleton)
# ---------------------------------------------------------------------------

_graph = None


def get_discovery_graph():
    """Return the compiled discovery graph (singleton)."""
    global _graph  # noqa: PLW0603
    if _graph is not None:
        return _graph

    builder = StateGraph(DiscoveryState)
    builder.add_node("understand", understand_node)
    builder.add_node("clarify", clarify_node)
    builder.add_node("search_offers", search_offers_node)
    builder.add_node("present", present_node)
    builder.add_node("sourcing", sourcing_node)
    builder.add_node("legacy_agent", legacy_agent_node)
    builder.add_node("respond", respond_node)

    builder.add_edge(START, "understand")
    builder.add_conditional_edges(
        "understand",
        route_after_understand,
        {
            "legacy_agent": "legacy_agent",
            "clarify": "clarify",
            "search_offers": "search_offers",
        },
    )
    builder.add_edge("clarify", "respond")
    builder.add_conditional_edges(
        "search_offers",
        route_after_search,
        {"present": "present", "sourcing": "sourcing"},
    )
    builder.add_edge("present", "respond")
    builder.add_edge("sourcing", "respond")
    builder.add_edge("legacy_agent", "respond")
    builder.add_edge("respond", END)

    _graph = builder.compile(checkpointer=_build_checkpointer())
    logger.info("Discovery graph compiled")
    return _graph
