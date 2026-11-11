"""Agent service: SSE streaming orchestration powered by LangChain AgentExecutor.

This module replaces the previous keyword-heuristic approach with a true
LangChain agent that autonomously decides when to use tools (search_creatives,
profile_deep_dive) and when to respond conversationally.

Responsibilities:
- Conversation lifecycle (create, load, persist)
- Memory management (buffer + summary + entity context)
- SSE event formatting and streaming
- Delegating decisions to the AgentExecutor
"""

from __future__ import annotations

import json
from typing import AsyncGenerator, List, Optional

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage

from app.core.database import get_supabase_client
from app.core.logging import get_logger
from app.models.agent import AgentMessageEvent, AgentRequest
from app.services.agent_executor import run_agent_streaming
from app.services.entity_memory import EntityMemoryManager
from app.services.memory_manager import AgentMemoryManager

logger = get_logger("services.agent")


async def _create_new_conversation(user_id: str, first_message: str) -> str:
    """Create a new conversation in the database.

    Args:
        user_id: User ID creating the conversation
        first_message: First message to use for title generation

    Returns:
        Conversation ID (UUID)
    """
    try:
        supabase = await get_supabase_client()

        title = first_message[:50] + "..." if len(first_message) > 50 else first_message

        result = (
            supabase._client.table("agent_conversations")
            .insert({"user_id": user_id, "title": title})
            .execute()
        )

        conversation_id = result.data[0]["id"]
        logger.info(
            "Created new conversation",
            conversation_id=conversation_id,
            user_id=user_id,
        )
        return conversation_id

    except Exception as e:
        logger.error("Failed to create conversation", user_id=user_id, error=str(e))
        raise


async def stream_agent_response(
    request: AgentRequest, user_id: str
) -> AsyncGenerator[str, None]:
    """Async generator yielding SSE-compatible event strings.

    Orchestration flow:
    1. Create or load conversation
    2. Load memory (buffer + summary) and entity context
    3. Build LangChain chat_history from memory
    4. Run AgentExecutor (which autonomously decides tools vs. direct response)
    5. Stream SSE events (message, profiles, search_log, done)
    6. Persist messages and update entities

    Args:
        request: Agent request with message and optional conversation_id.
        user_id: Authenticated user ID.

    Yields:
        SSE-formatted strings: ``data: {"type": ..., "content": ...}\n\n``
    """
    message = request.message
    conversation_id = request.conversation_id

    # ---- 1. Conversation lifecycle ----
    if not conversation_id:
        try:
            conversation_id = await _create_new_conversation(user_id, message)
        except Exception as e:
            logger.error(
                "Failed to create conversation, continuing without persistence",
                error=str(e),
            )
            conversation_id = None

    # ---- 2. Load memory ----
    memory_mgr: Optional[AgentMemoryManager] = None
    entity_mgr: Optional[EntityMemoryManager] = None
    chat_history: List[BaseMessage] = []
    entity_context = ""

    if conversation_id:
        try:
            memory_mgr = AgentMemoryManager(conversation_id, user_id)
            summary, messages = await memory_mgr.load_conversation_context()
            chat_history = list(messages)

            logger.info(
                "Loaded conversation context",
                conversation_id=conversation_id,
                has_summary=summary is not None,
                message_count=len(messages),
            )
        except Exception as e:
            logger.error(
                "Failed to load memory, continuing without context",
                error=str(e),
            )
            memory_mgr = None

        # Load entity context
        try:
            entity_mgr = EntityMemoryManager(conversation_id, user_id)
            entities = await entity_mgr.load_entities()
            if entities:
                entity_context = entity_mgr.format_for_prompt()
                logger.info(
                    "Entity context loaded",
                    conversation_id=conversation_id,
                    entity_keys=list(entities.keys()),
                )
        except Exception as e:
            logger.warning("Entity memory load failed", error=str(e))
            entity_mgr = None

    # Add current user message to memory buffer
    if memory_mgr:
        memory_mgr.add_user_message(message)

    # ---- 3. Run AgentExecutor and stream SSE events ----
    reply_text = ""
    search_log_id: Optional[str] = None
    tools_used: List[str] = []

    async for event in run_agent_streaming(
        user_id=user_id,
        message=message,
        chat_history=chat_history,
        entity_context=entity_context,
    ):
        event_type = event["type"]
        content = event["content"]

        if event_type == "message":
            reply_text += content
            sse_event = AgentMessageEvent(type="message", content=content)
            yield f"data: {json.dumps(sse_event.model_dump())}\n\n"

        elif event_type == "search_log":
            search_log_id = content.get("log_id")
            logger.info("Emitting search_log SSE event", log_id=search_log_id)
            yield f"data: {json.dumps({'type': 'search_log', 'content': content})}\n\n"

        elif event_type == "profiles":
            yield f"data: {json.dumps({'type': 'profiles', 'content': content})}\n\n"

        elif event_type == "tool_used":
            tools_used.append(content)

        elif event_type == "done":
            pass  # Handled below

    # ---- 4. Persist messages + update entities ----
    if memory_mgr:
        try:
            tool_used_str = ",".join(tools_used) if tools_used else None

            await memory_mgr.save_message("user", message, sender_id=user_id)
            await memory_mgr.save_message(
                "assistant",
                reply_text,
                tool_used=tool_used_str,
                search_log_id=search_log_id,
            )

            # Add AI message to buffer for summary generation
            memory_mgr.add_ai_message(reply_text)

            # Generate summary when buffer exceeds ~3000 estimated tokens
            if memory_mgr.should_summarize():
                await memory_mgr.generate_and_save_summary()
                logger.info(
                    "Generated conversation summary (token threshold reached)",
                    conversation_id=conversation_id,
                    message_count=memory_mgr.get_message_count(),
                )
        except Exception as e:
            logger.error("Failed to save messages", error=str(e))

    # Update entity memory after each turn
    if entity_mgr and reply_text:
        try:
            await entity_mgr.extract_and_save_entities(message, reply_text)
        except Exception as e:
            logger.warning("Entity extraction failed", error=str(e))

    # ---- 5. Final done event ----
    yield f"data: {json.dumps({'type': 'done', 'content': 'end'})}\n\n"
