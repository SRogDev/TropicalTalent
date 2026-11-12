"""Agent service: SSE streaming orchestration (Phase 3 — LangGraph).

The turn is orchestrated by the discovery graph
(`app.services.discovery_graph`): understand -> clarify / search /
present / sourcing, with the AgentExecutor surviving only inside the
graph's `legacy_agent` node for greetings, comparisons, and named-
person turns. This module keeps the responsibilities that are not
orchestration: conversation lifecycle, memory (buffer + summary +
entities), SSE formatting, and persistence.

Event contract: see `app.services.discovery_events` and
docs/architecture/ai-orchestration.md §2 (O12). The service streams
the graph's events verbatim, except `tool_used`, which is collected
for persistence and never sent to the client (as before).
"""

from __future__ import annotations

from typing import AsyncGenerator, List, Optional
from uuid import uuid4

from langchain_core.messages import BaseMessage, HumanMessage

from app.core.database import get_supabase_client
from app.core.logging import get_logger
from app.models.agent import AgentRequest
from app.services.discovery_events import format_sse
from app.services.discovery_graph import get_discovery_graph
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
    4. Run the discovery graph (LangGraph; AgentExecutor only inside
       its legacy node) and stream its SSE events
    5. Persist messages and update entities

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

    # ---- 3. Run the discovery graph and stream its SSE events ----
    # The checkpointer keys state by thread_id = conversation_id, so a
    # second turn on the same conversation resumes the graph (same
    # pattern as Team Search). Without persistence the thread is
    # ephemeral and state is lost after the turn.
    graph = get_discovery_graph()
    thread_id = conversation_id or f"ephemeral-{uuid4()}"
    config = {"configurable": {"thread_id": thread_id}}

    try:
        snapshot = graph.get_state(config)
        graph_started = bool(snapshot and snapshot.values)
    except Exception:
        graph_started = False

    if graph_started:
        # Resume: only the new message; requirements, clarification
        # count, and offers persist in the checkpoint.
        input_state = {
            "messages": [HumanMessage(content=message)],
            "query": message,
        }
    else:
        input_state = {
            "messages": [*chat_history, HumanMessage(content=message)],
            "user_id": user_id,
            "conversation_id": conversation_id or thread_id,
            "query": message,
            "entity_context": entity_context,
            "requirements": {},
            "clarification_count": 0,
            "clarification_questions": [],
            "offers": [],
            "partial_offers": [],
            "sourcing_request": None,
            "legacy_events": [],
            "events": [],
            "reply_text": "",
            "route": "",
            "status": "",
            "error_message": None,
            "tools_used": [],
            "search_log_id": None,
        }

    reply_text = ""
    search_log_id: Optional[str] = None
    tools_used: List[str] = []

    try:
        final_state = await graph.ainvoke(input_state, config=config)
        events = final_state.get("events") or []
        reply_text = final_state.get("reply_text") or ""
        search_log_id = final_state.get("search_log_id")
        tools_used = list(final_state.get("tools_used") or [])
    except Exception as e:
        logger.error("Discovery graph failed", error=str(e), user_id=user_id)
        events = [
            {
                "type": "message",
                "content": "I'm sorry, something went wrong. Could you try rephrasing your request?",
            },
            {"type": "done", "content": "end"},
        ]
        reply_text = events[0]["content"]

    # First event: the conversation id, so the client can resume this
    # thread on the next turn (same pattern as Team Search).
    if conversation_id:
        yield format_sse(
            {"type": "conversation_id", "content": conversation_id}
        )

    for event in events:
        event_type = event.get("type")
        if event_type == "tool_used":
            # Collected for persistence, never streamed (as before).
            tools_used.append(event.get("content"))
            continue
        if event_type == "search_log":
            search_log_id = (event.get("content") or {}).get("log_id")
        yield format_sse(event)

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
    # The graph's event list already ends with done; emit it only if the
    # graph produced no events at all (defensive — the client must never
    # hang on an unterminated stream).
    if not events:
        yield format_sse({"type": "done", "content": "end"})
