"""Agent conversation memory management using LangChain.

This module manages conversation memory for the agent, integrating with
Supabase for persistence and LangChain message types for context management.
"""

from typing import List, Optional, Tuple

from langchain_community.chat_message_histories import ChatMessageHistory
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage

'''from app.core.database import get_supabase_client'''
from app.core.logging import get_logger
from app.services.query_enricher import get_gemini_chat_model

from app.core.config import get_settings
from supabase import create_client

logger = get_logger("services.memory_manager")


class AgentMemoryManager:
    """Manages conversation memory for the agent using LangChain.

    Features:
    - Loads conversation history from Supabase
    - Maintains recent context using ConversationBufferMemory
    - Generates summaries for conversation switching
    - Persists messages and summaries to database

    Memory Strategy:
    - If messages < 10: Use all messages as context
    - If messages >= 10 and no summary: Generate summary
    - If summary exists: Use summary + last 5 messages for context
    """

    def __init__(self, conversation_id: str, user_id: str, buffer_size: int = 20):
        """Initialize memory manager for a conversation.

        Args:
            conversation_id: UUID of the conversation
            user_id: UUID of the user
            buffer_size: Number of messages to keep in buffer (default: 20)
        """
        self.conversation_id = conversation_id
        self.user_id = user_id
        self.buffer_size = buffer_size

        # LangChain ChatMessageHistory for active conversation
        self.buffer_memory = ChatMessageHistory()

        from supabase import create_client
        settings = get_settings()
        self.supabase = create_client(settings.supabase_url, settings.supabase_service_role_key)
        
        self._loaded_summary: Optional[str] = None

    async def load_conversation_context(
        self,
    ) -> Tuple[Optional[str], List[BaseMessage]]:
        """Load conversation summary and recent messages from database.

        Returns:
            Tuple of (summary, messages_list)
        """
        try:
            # Load conversation metadata (including summary)
            conv_resp = (
                self.supabase.table("agent_conversations")
                .select("summary")
                .eq("id", self.conversation_id)
                .single()
                .execute()
            )

            summary = conv_resp.data.get("summary") if conv_resp.data else None

            # Load recent messages (last buffer_size messages)
            messages_resp = (
                self.supabase.table("agent_messages")
                .select("role, content, created_at")
                .eq("conversation_id", self.conversation_id)
                .order("created_at", desc=False)
                .limit(self.buffer_size)
                .execute()
            )

            # Convert to LangChain message format
            messages = []
            if messages_resp.data:
                for msg in messages_resp.data:
                    if msg["role"] == "user":
                        messages.append(HumanMessage(content=msg["content"]))
                    elif msg["role"] == "assistant":
                        messages.append(AIMessage(content=msg["content"]))

                # Keep only most recent buffer_size messages
                if len(messages) > self.buffer_size:
                    messages = messages[-self.buffer_size :]

                # Load into buffer memory
                for msg in messages:
                    self.buffer_memory.add_message(msg)

            # Store summary for later use
            self._loaded_summary = summary

            logger.info(
                "Loaded conversation context",
                conversation_id=self.conversation_id,
                has_summary=summary is not None,
                message_count=len(messages),
            )

            return summary, messages

        except Exception as e:
            logger.error(
                "Failed to load conversation context",
                conversation_id=self.conversation_id,
                error=str(e),
            )
            return None, []

    def add_user_message(self, content: str):
        """Add user message to memory buffer.

        Args:
            content: User message content
        """
        self.buffer_memory.add_message(HumanMessage(content=content))

    def add_ai_message(self, content: str):
        """Add AI message to memory buffer.

        Args:
            content: AI response content
        """
        self.buffer_memory.add_message(AIMessage(content=content))

    async def save_message(
        self,
        role: str,
        content: str,
        tool_used: Optional[str] = None,
        search_log_id: Optional[str] = None,
        sender_id: Optional[str] = None,
    ) -> bool:
        """Persist message to database.

        Args:
            role: 'user' or 'assistant'
            content: Message content
            tool_used: Name of tool used (if any)
            search_log_id: Reference to search log (if applicable)

        Returns:
            True if successful, False otherwise
        """
        try:
            self.supabase.table("agent_messages").insert(
                {
                    "conversation_id": self.conversation_id,
                    "role": role,
                    "content": content,
                    "tool_used": tool_used,
                    "search_log_id": search_log_id,
                    "sender_id": sender_id,
                }
            ).execute()

            logger.info(
                "Saved message to database",
                conversation_id=self.conversation_id,
                role=role,
            )
            return True

        except Exception as e:
            logger.error(
                "Failed to save message",
                conversation_id=self.conversation_id,
                role=role,
                error=str(e),
            )
            return False

    async def generate_and_save_summary(self) -> Optional[str]:
        """Generate conversation summary and save to database.

        Uses Gemini to create a concise summary of the conversation
        for context restoration when switching conversations.

        Triggered by token-estimate rather than raw message count:
        ~3000 tokens (~12k chars at 4 chars/token) is the threshold.
        This avoids summarising too early on short exchanges or too
        late when messages are very long.

        Returns:
            Generated summary or None if failed
        """
        try:
            # Get all messages from buffer
            messages = self.buffer_memory.messages

            if len(messages) < 4:  # Need at least 2 full exchanges
                logger.info("Not enough messages for summary generation")
                return None

            # Build conversation string for summary
            conversation_text = "\n".join(
                [
                    f"{'User' if isinstance(msg, HumanMessage) else 'Assistant'}: {msg.content}"
                    for msg in messages
                ]
            )

            # Generate summary using Gemini
            llm = get_gemini_chat_model()
            summary_prompt = (
                "Provide a brief summary (2-3 sentences) of this conversation "
                "between a user and an AI assistant. Focus on the main topics "
                "discussed and any key outcomes or decisions.\n\n"
                f"Conversation:\n{conversation_text}\n\n"
                "Summary:"
            )

            response = await llm.ainvoke(summary_prompt)
            summary = response.content.strip()

            # Save summary to database
            self.supabase.table("agent_conversations").update({"summary": summary}).eq(
                "id", self.conversation_id
            ).execute()

            # Update stored summary
            self._loaded_summary = summary

            logger.info(
                "Generated and saved conversation summary",
                conversation_id=self.conversation_id,
                summary_length=len(summary),
            )

            return summary

        except Exception as e:
            logger.error(
                "Failed to generate summary",
                conversation_id=self.conversation_id,
                error=str(e),
            )
            return None

    def get_context_for_prompt(self, include_summary: bool = True) -> str:
        """Get formatted conversation context for prompt injection.

        Strategy:
        - If summary exists: Use summary + last 5 messages
        - If no summary: Use all messages from buffer

        Args:
            include_summary: Whether to include conversation summary

        Returns:
            Formatted context string
        """
        context_parts = []

        # Get messages from buffer
        messages = self.buffer_memory.messages

        # If we have a summary, use it with recent messages
        if include_summary and self._loaded_summary:
            context_parts.append(
                f"Previous conversation summary: {self._loaded_summary}"
            )

            # Add only last 5 messages for recent context
            recent_messages = (
                messages[-10:] if len(messages) > 10 else messages
            )  # Last 5 exchanges (10 messages)
            if recent_messages:
                recent_context = "\n".join(
                    [
                        f"{'User' if isinstance(msg, HumanMessage) else 'Assistant'}: {msg.content}"
                        for msg in recent_messages
                    ]
                )
                context_parts.append(f"Recent conversation:\n{recent_context}")
        else:
            # No summary, use all messages
            if messages:
                all_context = "\n".join(
                    [
                        f"{'User' if isinstance(msg, HumanMessage) else 'Assistant'}: {msg.content}"
                        for msg in messages
                    ]
                )
                context_parts.append(f"Conversation history:\n{all_context}")

        return "\n\n".join(context_parts) if context_parts else ""

    def get_message_count(self) -> int:
        """Get total number of messages in buffer.

        Returns:
            Number of messages in buffer
        """
        return len(self.buffer_memory.messages)

    def should_summarize(self, token_threshold: int = 3000) -> bool:
        """Check whether the buffer is large enough to warrant a summary.

        Uses a rough character-to-token estimate (4 chars ≈ 1 token).
        Avoids triggering when a fresh summary was just saved.

        Args:
            token_threshold: Estimated token count that triggers summarisation
                             (default 3000 ≈ 12 000 chars).

        Returns:
            True if the buffer content exceeds the threshold.
        """
        messages = self.buffer_memory.messages
        if len(messages) < 4:
            return False
        total_chars = sum(len(msg.content) for msg in messages)
        estimated_tokens = total_chars // 4
        return estimated_tokens >= token_threshold
