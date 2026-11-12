"""Agent API router: /api/agent endpoint streaming SSE responses."""

from typing import List

import sentry_sdk
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.core.database import get_supabase_client
from app.core.logging import get_logger
from app.dependencies.auth import get_current_user
from app.dependencies.rate_limiting import rate_limit
from app.models.agent import (
    AgentConversationCreate,
    AgentConversationResponse,
    AgentMessageResponse,
    AgentRequest,
)
from app.services.agent_service import stream_agent_response

router = APIRouter(prefix="/api", tags=["Agent"])
logger = get_logger("routes.agent")


@router.post("/agent")
async def agent_endpoint(
    payload: AgentRequest,
    current_user: dict = Depends(get_current_user),
    _rl: None = Depends(rate_limit),
):
    """POST /api/agent

    Streams Server-Sent Events (SSE) with JSON payloads. Each event is
    a JSON object with `type` and `content` fields.

    Supports conversation memory:
    - If conversation_id is provided, continues existing conversation
    - If not provided, creates a new conversation
    - Maintains context across messages using LangChain memory
    """
    try:
        user_id = current_user.get("sub")

        async def event_generator():
            async for chunk in stream_agent_response(payload, user_id):
                # Each chunk is already a properly formatted SSE 'data: ...\n\n' string
                yield chunk

        return StreamingResponse(event_generator(), media_type="text/event-stream")

    except Exception as e:  # pylint: disable=broad-except
        # Catch any unexpected errors during agent streaming.
        # sentry_sdk 2.x removed push_scope(); new_scope() is its
        # replacement (Phase 3 fixed this on the migrated agent path;
        # the remaining push_scope sites are a Phase 5 item).
        with sentry_sdk.new_scope() as scope:
            scope.set_extra("endpoint", "agent")
            scope.set_extra("authenticated_user", current_user.get("sub"))
            scope.set_extra("message", payload.message)
            scope.set_extra("conversation_id", payload.conversation_id)
            sentry_sdk.capture_exception(e)
        # Log the detail server-side; the client only gets a generic message.
        logger.error("Unexpected error in agent endpoint", error=str(e))
        raise HTTPException(status_code=500, detail="Agent request failed")


@router.post("/agent/conversations", response_model=AgentConversationResponse)
async def create_conversation(
    payload: AgentConversationCreate,
    current_user: dict = Depends(get_current_user),
):
    """POST /api/agent/conversations

    Create a new agent conversation.

    Returns the created conversation details.
    """
    try:
        user_id = current_user.get("sub")
        supabase = get_supabase_client()

        # Insert new conversation
        result = supabase.table("agent_conversations").insert({
            "user_id": user_id,
            "title": payload.title,
        }).execute()

        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to create conversation")

        conversation = result.data[0]
        logger.info("Created conversation", conversation_id=conversation["id"], user_id=user_id)

        return AgentConversationResponse(**conversation)

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to create conversation", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to create conversation")


@router.get("/agent/conversations", response_model=List[AgentConversationResponse])
async def list_conversations(
    current_user: dict = Depends(get_current_user),
):
    """GET /api/agent/conversations

    List all conversations for the current user, ordered by most recent first.
    """
    try:
        user_id = current_user.get("sub")
        supabase = get_supabase_client()

        # Fetch conversations for user
        result = supabase.table("agent_conversations") \
            .select("*") \
            .eq("user_id", user_id) \
            .order("updated_at", desc=True) \
            .execute()

        conversations = [AgentConversationResponse(**conv) for conv in result.data]
        return conversations

    except Exception as e:
        logger.error("Failed to list conversations", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to list conversations")


@router.get("/agent/conversations/{conversation_id}")
async def get_conversation(
    conversation_id: str,
    current_user: dict = Depends(get_current_user),
):
    """GET /api/agent/conversations/{conversation_id}

    Get conversation details and all messages.

    Returns:
        {
            "conversation": {...},
            "messages": [...]
        }
    """
    try:
        user_id = current_user.get("sub")
        supabase = get_supabase_client()

        # Fetch conversation and verify ownership
        conv_result = supabase.table("agent_conversations") \
            .select("*") \
            .eq("id", conversation_id) \
            .single() \
            .execute()

        if not conv_result.data:
            raise HTTPException(status_code=404, detail="Conversation not found")

        conversation = conv_result.data

        # Verify user owns conversation
        if conversation["user_id"] != user_id:
            raise HTTPException(status_code=403, detail="Access denied")

        # Fetch messages for conversation
        messages_result = supabase.table("agent_messages") \
            .select("*") \
            .eq("conversation_id", conversation_id) \
            .order("created_at", desc=False) \
            .execute()

        messages = [AgentMessageResponse(**msg) for msg in messages_result.data]

        return {
            "conversation": AgentConversationResponse(**conversation),
            "messages": messages
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to get conversation", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to get conversation")


@router.delete("/agent/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: str,
    current_user: dict = Depends(get_current_user),
):
    """DELETE /api/agent/conversations/{conversation_id}

    Delete a conversation and all its messages.
    Messages are cascade deleted by database foreign key constraints.
    """
    try:
        user_id = current_user.get("sub")
        supabase = get_supabase_client()

        # Fetch conversation to verify ownership
        conv_result = supabase.table("agent_conversations") \
            .select("user_id") \
            .eq("id", conversation_id) \
            .single() \
            .execute()

        if not conv_result.data:
            raise HTTPException(status_code=404, detail="Conversation not found")

        # Verify user owns conversation
        if conv_result.data["user_id"] != user_id:
            raise HTTPException(status_code=403, detail="Access denied")

        # Delete conversation (messages cascade delete)
        supabase.table("agent_conversations") \
            .delete() \
            .eq("id", conversation_id) \
            .execute()

        logger.info("Deleted conversation", conversation_id=conversation_id, user_id=user_id)

        return {"success": True, "message": "Conversation deleted"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to delete conversation", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to delete conversation")
