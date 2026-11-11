-- Migration: Add summary field and indexes for agent conversations
-- Purpose: Enable conversation context restoration and improve query performance

-- Add summary field to agent_conversations table
ALTER TABLE public.agent_conversations
ADD COLUMN IF NOT EXISTS summary text;

-- Add index for faster conversation retrieval by user (most recent first)
CREATE INDEX IF NOT EXISTS agent_conversations_user_id_updated_at_idx
ON public.agent_conversations(user_id, updated_at DESC);

-- Add index for messages by conversation and timestamp (chronological order)
CREATE INDEX IF NOT EXISTS agent_messages_conversation_id_created_at_idx
ON public.agent_messages(conversation_id, created_at ASC);

-- Function to auto-update conversation.updated_at when messages are added
CREATE OR REPLACE FUNCTION update_agent_conversation_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.agent_conversations
    SET updated_at = now()
    WHERE id = NEW.conversation_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists (for idempotency)
DROP TRIGGER IF EXISTS agent_messages_update_conversation_timestamp ON public.agent_messages;

-- Trigger to auto-update conversation timestamp when messages are added
CREATE TRIGGER agent_messages_update_conversation_timestamp
AFTER INSERT ON public.agent_messages
FOR EACH ROW
EXECUTE FUNCTION update_agent_conversation_timestamp();

-- Add comment for documentation
COMMENT ON COLUMN public.agent_conversations.summary IS 'AI-generated summary of conversation for context restoration when switching conversations';
