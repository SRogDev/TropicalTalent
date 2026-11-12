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
        ┌──────────────┐
        │ crm_handoff  │  approval → complete, no Supabase writes
        └──────┬───────┘  (Phase 4: project creation + invitations are
               │           owned by the Cubora CRM, not this graph)
               ▼
          ┌─────────┐
          │ complete │
          └─────────┘

Phase 4 (2026-11-12): the `project_creator` and `persuasion_agent`
nodes are DISABLED and no longer in this graph. They wrote to the
legacy `projects` / `project_members` / `connections` / `messages`
tables, which no web migration creates; creating those tables would
resurrect a second project model nothing in the web reads. The modules
stay in the tree, marked DISABLED, as history. Approval now ends at
`crm_handoff` (see its docstring).

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

from langchain_core.messages import AIMessage, HumanMessage
from langgraph.graph import END, START, StateGraph

from app.core.logging import get_logger
from app.services.team_search.agents.business_agent import business_agent_node
from app.services.team_search.agents.people_analyst import people_analyst_node
from app.services.team_search.agents.search_agent import search_agent_node
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


async def crm_handoff_node(state: TeamSearchState) -> dict:
    """Terminal node: an approved team hands off to Cubora operations.

    Phase 4 decision (see docs/architecture/ai-orchestration.md §4):
    the graph's `project_creator` and `persuasion_agent` nodes are
    DISABLED — they wrote to the legacy `projects` / `project_members` /
    `connections` / `messages` tables, which no web migration creates,
    and creating those tables would resurrect a second project model
    that nothing in the web reads. The Cubora commercial operation is
    the negotiation, owned by the Phase 4 CRM (migration 056). This node
    therefore writes nothing to Supabase: it marks the run complete and
    tells the user operations will open the commercial operation and
    contact them through Cubora.
    """
    project_name = state.get("project_name", "your project")
    team = state.get("selected_team", [])
    logger.info(
        "Team approved — handing off to Cubora operations",
        project_name=project_name,
        team_size=len(team),
    )
    return {
        "status": "complete",
        "project_id": None,
        "messages": [
            AIMessage(
                content=(
                    f"Team approved for **{project_name}**. Cubora operations "
                    "will open the commercial operation for this team and "
                    "coordinate the next steps with you — no project is "
                    "created automatically."
                )
            )
        ],
    }


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
) -> Literal["business_agent", "people_analyst", "crm_handoff"]:
    """Route after the reviewing interrupt resumes.

    Decision matrix:
      approval phrase  → crm_handoff (Phase 4: project creation and
                         invitations are owned by the Cubora CRM, not
                         by this graph — see crm_handoff_node)
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
        return "crm_handoff"

    # --- Analysis request (deep dive / compare) ---
    if any(phrase in text for phrase in _ANALYSE_PHRASES):
        return "people_analyst"

    # --- Default: route back for team adjustments ---
    return "business_agent"


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
    builder.add_node("crm_handoff", crm_handoff_node)

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
            "crm_handoff": "crm_handoff",
        },
    )

    # People Analyst → back to reviewing interrupt
    builder.add_conditional_edges(
        "people_analyst",
        route_after_people_analyst,
        {"reviewing": "reviewing"},
    )

    # CRM handoff → done (the node itself sets status='complete')
    builder.add_edge("crm_handoff", END)

    _graph = builder.compile(
        checkpointer=checkpointer,
        interrupt_before=["reviewing"],
    )

    logger.info("Team Search graph compiled")
    return _graph

