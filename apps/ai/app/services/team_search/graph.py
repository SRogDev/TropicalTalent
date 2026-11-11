"""Team Search LangGraph graph definition.

Graph structure:
                      ┌──────────────┐
                      │ business_agent│◄──────────────────┐
                      └──────┬───────┘                    │
                             │ status='searching'          │ status='clarifying'
                             ▼                             │
                      ┌──────────────┐                    │
                      │ search_agent │                     │
                      └──────┬───────┘                    │
                             │ status='reviewing'          │
                     INTERRUPT▼ (user reviews)             │
                      ┌──────────────────────────────┐    │
          approve ────┤       reviewing              ├────┘ swap/clarify
              │       │  (route_after_review)        │
              │       └──────┬───────────────────────┘
              │              │ "tell me more" / "compare"
              │              ▼
              │       ┌─────────────────┐
              │       │ people_analyst  ├──► back to interrupt (reviewing)
              │       └─────────────────┘
              │
              ▼
        ┌──────────────┐   mode='update'   ┌──────────────────┐
        │ route_create │──────────────────►│ persuasion_agent │
        └──────┬───────┘                   └──────┬───────────┘
               │ mode='create'                     │
               ▼                                   │
        ┌──────────────┐                           │
        │project_creator│                          │
        └──────┬────────┘                          │
               └───────────────────────────────────┘
                                                   ▼
                                              ┌─────────┐
                                              │ complete │
                                              └─────────┘

Checkpointer:
  Uses Upstash Redis (via UPSTASH_REDIS_URL env var) when available,
  falls back to in-memory MemorySaver for local dev.

Usage:
    graph = get_team_search_graph()
    config = {"configurable": {"thread_id": conversation_id}}
    result = await graph.ainvoke(input_state, config=config)
"""

from __future__ import annotations

from typing import Literal

from langchain_core.messages import HumanMessage
from langgraph.graph import END, START, StateGraph

from app.core.logging import get_logger
from app.services.team_search.agents.business_agent import business_agent_node
from app.services.team_search.agents.people_analyst import people_analyst_node
from app.services.team_search.agents.persuasion_agent import persuasion_agent_node
from app.services.team_search.agents.search_agent import search_agent_node
from app.services.team_search.nodes.project_creator import project_creator_node
from app.services.team_search.state import TeamSearchState

logger = get_logger("team_search.graph")

# ---------------------------------------------------------------------------
# Keywords that trigger the People Analyst instead of the Business Agent
# ---------------------------------------------------------------------------
_ANALYSE_PHRASES = {
    "tell me more", "more about", "tell me about", "who is", "what does",
    "compare", "vs", "versus", "difference between", "which one",
    "analyse", "analyze", "deep dive", "deeper", "learn more about",
    "is @", "profile of", "portfolio of",
}

_APPROVE_PHRASES = {
    "yes", "proceed", "looks good", "ok", "approve", "send", "great",
    "perfect", "go ahead", "confirmed", "confirm", "do it", "let's go",
    "that works", "all good",
}


# ---------------------------------------------------------------------------
# Pass-through reviewing node (interrupt_before pauses BEFORE this node)
# ---------------------------------------------------------------------------

async def reviewing_node(state: TeamSearchState) -> dict:  # noqa: ARG001
    """Pass-through node.  interrupt_before=["reviewing"] pauses before entry.
    On resume, route_after_review inspects the new HumanMessage and routes.
    """
    return {}


# ---------------------------------------------------------------------------
# Routing helpers
# ---------------------------------------------------------------------------

def route_after_agent(
    state: TeamSearchState,
) -> Literal["business_agent", "search_agent", "__end__"]:
    """Route after business_agent_node runs."""
    status = state.get("status", "clarifying")
    if status == "searching":
        return "search_agent"
    if status in ("error", "complete"):
        return END
    return "business_agent"


def route_after_review(
    state: TeamSearchState,
) -> Literal["business_agent", "people_analyst", "project_creator", "persuasion_agent"]:
    """Route after the reviewing interrupt resumes.

    Decision matrix:
      approval phrase  → project_creator (create) or persuasion_agent (update)
      analysis request → people_analyst  (returns to reviewing)
      anything else    → business_agent  (swap / adjust team)
    """
    messages = state.get("messages", [])
    last_human = next(
        (m for m in reversed(messages) if isinstance(m, HumanMessage)), None
    )

    if not last_human:
        return "business_agent"

    text = last_human.content.strip().lower()

    # --- Approval ---
    if any(phrase in text for phrase in _APPROVE_PHRASES):
        mode = state.get("mode", "create")
        return "persuasion_agent" if mode == "update" else "project_creator"

    # --- Analysis request (deep dive / compare) ---
    if any(phrase in text for phrase in _ANALYSE_PHRASES):
        return "people_analyst"

    # --- Default: route back for team adjustments ---
    return "business_agent"


def route_after_project_creator(
    state: TeamSearchState,
) -> Literal["persuasion_agent", "__end__"]:
    return END if state.get("status") == "error" else "persuasion_agent"


def route_after_people_analyst(
    state: TeamSearchState,
) -> Literal["reviewing"]:
    """Always return to reviewing after an analysis."""  # noqa: D401
    return "reviewing"


# ---------------------------------------------------------------------------
# Checkpointer factory (Upstash → MemorySaver fallback)
# ---------------------------------------------------------------------------

def _build_checkpointer():
    """Return a Redis checkpointer (Upstash) or MemorySaver as fallback."""
    from app.core.config import get_settings  # noqa: PLC0415 — avoid circular import at module load

    settings = get_settings()
    url = getattr(settings, "upstash_redis_url", None)

    if url:
        try:
            from langgraph.checkpoint.redis import RedisSaver  # noqa: PLC0415

            checkpointer = RedisSaver.from_conn_string(url)
            checkpointer.setup()  # Ensures necessary Redis data structures exist
            logger.info("LangGraph checkpointer: Upstash Redis")
            return checkpointer
        except Exception as exc:  # pylint: disable=broad-except
            logger.warning(
                "Upstash Redis unavailable — falling back to MemorySaver",
                error=str(exc),
            )

    from langgraph.checkpoint.memory import MemorySaver  # noqa: PLC0415

    logger.info("LangGraph checkpointer: MemorySaver (in-process only)")
    return MemorySaver()


# ---------------------------------------------------------------------------
# Graph construction (singleton)
# ---------------------------------------------------------------------------

_graph = None


def get_team_search_graph():
    """Return the compiled Team Search graph (singleton, thread-safe at startup)."""
    global _graph  # noqa: PLW0603
    if _graph is not None:
        return _graph

    checkpointer = _build_checkpointer()

    builder = StateGraph(TeamSearchState)

    # Nodes
    builder.add_node("business_agent", business_agent_node)
    builder.add_node("search_agent", search_agent_node)
    builder.add_node("reviewing", reviewing_node)
    builder.add_node("people_analyst", people_analyst_node)
    builder.add_node("project_creator", project_creator_node)
    builder.add_node("persuasion_agent", persuasion_agent_node)

    # Entry
    builder.add_edge(START, "business_agent")

    # Business Agent → loop or proceed
    builder.add_conditional_edges(
        "business_agent",
        route_after_agent,
        {
            "business_agent": "business_agent",
            "search_agent": "search_agent",
            END: END,
        },
    )

    # Search Agent → reviewing interrupt
    builder.add_edge("search_agent", "reviewing")

    # Reviewing → approve / analyse / adjust
    builder.add_conditional_edges(
        "reviewing",
        route_after_review,
        {
            "business_agent": "business_agent",
            "people_analyst": "people_analyst",
            "project_creator": "project_creator",
            "persuasion_agent": "persuasion_agent",
        },
    )

    # People Analyst → back to reviewing interrupt
    builder.add_conditional_edges(
        "people_analyst",
        route_after_people_analyst,
        {"reviewing": "reviewing"},
    )

    # Project Creator → persuasion or error
    builder.add_conditional_edges(
        "project_creator",
        route_after_project_creator,
        {
            "persuasion_agent": "persuasion_agent",
            END: END,
        },
    )

    # Persuasion Agent → done
    builder.add_edge("persuasion_agent", END)

    _graph = builder.compile(
        checkpointer=checkpointer,
        interrupt_before=["reviewing"],
    )

    logger.info("Team Search graph compiled")
    return _graph

