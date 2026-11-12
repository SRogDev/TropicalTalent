"""Team Search API router: POST /api/team-search

Re-enabled in Phase 3 (Cubora) behind the same JWT auth + rate limit
as the agent routes. Streams SSE events from the LangGraph Team Search
multiagent system.

Known limitation (decided in Phase 4, not hidden): the graph's
`project_creator` and `persuasion_agent` nodes are DISABLED — they
wrote to the legacy `projects` / `project_members` / `connections` /
`messages` tables, which no web migration creates, and creating those
tables would resurrect a second project model nothing in the web reads.
Approval of a reviewed team now ends at the `crm_handoff` node
(status `complete`, no Supabase writes): Cubora operations opens the
negotiation in the Phase 4 CRM (migration 056) and coordinates the
next steps. See docs/architecture/ai-orchestration.md §4. The route
also writes `agent_conversations.mode` — added by migration 055.

SSE event types:
  message           — text from any agent (business, persuasion)
  team_question     — clarifying question from Business Agent
  team_update       — proposed team JSON from Search Agent (triggers interrupt)
  team_created      — project was created (includes project_id)
  invitations_sent  — list of invited usernames
  error             — unrecoverable error
  done              — stream complete

Flow per request:
  1. Auth + rate limit
  2. Create or load agent_conversation (mode='team_search')
  3. Invoke LangGraph graph with thread_id = conversation_id
  4. Stream events based on resulting state
  5. If graph interrupted at 'reviewing': emit team_update SSE and stop stream
  6. On next request (same conversation_id): graph resumes from interrupt
"""

from __future__ import annotations

import json
from typing import AsyncGenerator, Literal, Optional

import sentry_sdk
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from langchain_core.messages import AIMessage, HumanMessage
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.core.logging import get_logger
from app.dependencies.auth import get_current_user
from app.dependencies.rate_limiting import rate_limit
from app.services.team_search.graph import get_team_search_graph
from supabase import create_client

router = APIRouter(prefix="/api", tags=["Team Search"])
logger = get_logger("routes.team_search")


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class TeamSearchRequest(BaseModel):
    """Request payload for POST /api/team-search."""

    message: str = Field(..., min_length=1)
    conversation_id: Optional[str] = None
    mode: Literal["create", "update"] = "create"
    # Only used in 'update' mode — the existing project to add members to
    project_id: Optional[str] = None


# ---------------------------------------------------------------------------
# SSE helpers
# ---------------------------------------------------------------------------

def _sse(event_type: str, data: object) -> str:
    """Format a single SSE event string."""
    payload = json.dumps({"type": event_type, "content": data})
    return f"data: {payload}\n\n"


# ---------------------------------------------------------------------------
# Conversation persistence helpers
# ---------------------------------------------------------------------------

def _get_supabase():
    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def _create_or_get_conversation(user_id: str, conversation_id: Optional[str], title: str) -> str:
    """Return an existing conversation_id or create a new one (mode='team_search')."""
    supabase = _get_supabase()

    if conversation_id:
        result = (
            supabase.table("agent_conversations")
            .select("id, user_id")
            .eq("id", conversation_id)
            .single()
            .execute()
        )
        if result.data and result.data["user_id"] == user_id:
            return conversation_id
        # Conversation not found / wrong owner — create new
        logger.warning("Conversation not found or wrong owner, creating new", conv_id=conversation_id)

    result = (
        supabase.table("agent_conversations")
        .insert({"user_id": user_id, "title": title, "mode": "team_search"})
        .execute()
    )
    return result.data[0]["id"]


def _save_message(conversation_id: str, role: str, content: str) -> None:
    """Persist a message to the agent_messages table."""
    try:
        supabase = _get_supabase()
        supabase.table("agent_messages").insert(
            {"conversation_id": conversation_id, "role": role, "content": content}
        ).execute()
    except Exception as exc:
        logger.error("Failed to save team search message", error=str(exc))


# ---------------------------------------------------------------------------
# Core streaming generator
# ---------------------------------------------------------------------------

async def _stream_team_search(
    request: TeamSearchRequest, user_id: str
) -> AsyncGenerator[str, None]:
    """Core async generator: invokes the LangGraph graph and streams SSE events."""

    # 1. Create/load conversation
    title = request.message[:50] + ("..." if len(request.message) > 50 else "")
    conversation_id = _create_or_get_conversation(user_id, request.conversation_id, title)

    yield _sse("conversation_id", conversation_id)

    # 2. Persist the user's message
    _save_message(conversation_id, "user", request.message)

    # 3. Build LangGraph config (thread_id keys the MemorySaver)
    config = {"configurable": {"thread_id": conversation_id}}

    graph = get_team_search_graph()

    # 4. Check graph state to determine whether we are starting or resuming
    try:
        snapshot = graph.get_state(config)
        graph_started = bool(snapshot and snapshot.values)
    except Exception:
        graph_started = False

    if graph_started:
        # Resume from interrupt — inject the new user message
        input_state = {"messages": [HumanMessage(content=request.message)]}
    else:
        # First invocation — set up initial state
        input_state = {
            "messages": [HumanMessage(content=request.message)],
            "user_id": user_id,
            "mode": request.mode,
            "project_brief": "",
            "clarification_count": 0,
            "role_requirements": [],
            "project_name": "",
            "search_results": {},
            "selected_team": [],
            "project_id": request.project_id,
            "invitations_sent": [],
            "status": "clarifying",
            "error_message": None,
        }

    # 5. Run the graph (non-streaming — we inspect the output state)
    try:
        final_state = await graph.ainvoke(input_state, config=config)
    except Exception as exc:
        logger.error("Team Search graph error", error=str(exc))
        yield _sse("error", f"An unexpected error occurred: {exc}")
        yield _sse("done", {})
        return

    status = final_state.get("status", "")

    # 6. Stream events based on final status

    # Emit any new AI messages from the run
    messages = final_state.get("messages", [])
    # Find the last AI message (the most recent agent output)
    ai_messages = [m for m in messages if isinstance(m, AIMessage)]
    if ai_messages:
        last_ai = ai_messages[-1]
        event_type = "team_question" if status == "clarifying" else "message"
        yield _sse(event_type, last_ai.content)
        _save_message(conversation_id, "assistant", last_ai.content)

    # Status-specific events
    if status == "reviewing":
        # Graph is interrupted — send proposed team to UI
        selected_team = final_state.get("selected_team", [])
        yield _sse("team_update", {
            "selected_team": selected_team,
            "search_results": final_state.get("search_results", {}),
            "project_name": final_state.get("project_name", ""),
        })

    elif status == "creating":
        # Project creation in progress (transient — graph moves quickly through this)
        pass

    elif status == "complete":
        project_id = final_state.get("project_id")
        invitations_sent = final_state.get("invitations_sent", [])

        if project_id:
            yield _sse("team_created", {
                "project_id": project_id,
                "project_name": final_state.get("project_name", ""),
            })

        if invitations_sent:
            yield _sse("invitations_sent", {"usernames": invitations_sent})

    elif status == "error":
        error_msg = final_state.get("error_message", "Unknown error")
        yield _sse("error", error_msg)

    yield _sse("done", {"conversation_id": conversation_id})


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------

@router.post("/team-search")
async def team_search_endpoint(
    payload: TeamSearchRequest,
    current_user: dict = Depends(get_current_user),
    _rl: None = Depends(rate_limit),
):
    """POST /api/team-search

    Streams SSE events from the LangGraph Team Search multiagent system.

    The client should send the same conversation_id on subsequent requests
    to continue an existing team-building session (e.g. after the user
    reviews and approves the proposed team).
    """
    try:
        user_id = current_user.get("sub")

        async def event_generator():
            async for chunk in _stream_team_search(payload, user_id):
                yield chunk

        return StreamingResponse(event_generator(), media_type="text/event-stream")

    except Exception as exc:
        # sentry-sdk 2.x removed push_scope(); new_scope() is its
        # replacement (fixed on this re-enabled path in Phase 3).
        with sentry_sdk.new_scope() as scope:
            scope.set_extra("endpoint", "team_search")
            scope.set_extra("user_id", current_user.get("sub"))
            scope.set_extra("message", payload.message)
            sentry_sdk.capture_exception(exc)
        raise HTTPException(status_code=500, detail=str(exc))
