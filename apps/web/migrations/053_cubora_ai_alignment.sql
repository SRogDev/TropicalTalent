-- ============================================================================
-- 053 — AI-service schema alignment (Phase 2)
-- ============================================================================
-- The smaller correct option for the schema-alignment gap the Phase 0
-- audit found (§3.3): the AI service queries tables no web migration ever
-- created, so the two apps cannot share one live database as-is. This
-- migration creates exactly the tables the AI code reads/writes, with the
-- columns that code actually uses (verified against apps/ai on 2026-11-11):
--
--   agent_conversations       agent_service.py, memory_manager.py
--   agent_messages            agent_service.py, memory_manager.py, routes/agent.py
--   agent_conversation_entities  entity_memory.py (upsert on conversation_id)
--   search_logs               search_log_saver.py, routes/search_insights.py
--   feedback_messages         routes/feedback.py
--   opportunities             core/supabase_service.py (orphaned: no route calls it)
--   matching_results          core/supabase_service.py (orphaned likewise)
--
-- What this migration deliberately does NOT create:
-- * users / creative_data / brand_data / locations — pre-existing legacy
--   tables owned outside this runner (001 treats them as read-only); the
--   live database already has them. Creating them here would collide.
-- * connections / messages / projects / project_members — legacy tables the
--   disabled Team Search graph reads. Team Search is disabled (audit §3.2);
--   re-enable-or-cut is a separate decision, not Phase 2.
-- * A rename of creative_data -> tropical_* — out of scope; the AI config
--   documents the name as intentionally un-renamed (apps/ai/app/core/config.py).
--
-- The unified catalog (051/052) is the web's source of truth for offers.
-- The AI service does NOT read tropical_offers yet: its search path is
-- Pinecone user vectors + creative_data metadata. Wiring AI search to the
-- unified model (offer vectors, offer metadata) is Phase 3 work; the web
-- reaches the existing AI /search endpoint through a server-side route
-- handler (app/api/ai-search), which is the only seam Phase 2 adds.
--
-- RLS: the AI service uses the service-role key and bypasses RLS by
-- construction (audit §5.3), so these policies govern only direct
-- PostgREST access. Owner-only reads for the conversation/search/feedback
-- tables; opportunities and matching_results have NO user-facing policy —
-- they are service-only until a route actually serves them.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Agent conversations (human-to-AI chat persistence)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_conversations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title      text NOT NULL DEFAULT 'New conversation',
  summary    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_conversations_user_id_updated_at_idx
  ON public.agent_conversations (user_id, updated_at DESC);

-- ---------------------------------------------------------------------------
-- Search logs (embedding vectors + results per search; feeds recommendations
-- and the search-insights endpoint). `results` is the matched user-id list.
-- `behavioral_rating` is written by the feedback flow (0 = bad, 1-2 = good
-- per routes/search_insights.py); NULL = unrated.
-- Created BEFORE agent_messages: agent_messages.search_log_id references it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.search_logs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content                  text NOT NULL DEFAULT '',
  original_query           text,
  results                  text[] NOT NULL DEFAULT '{}',
  embedding                real[],
  similarity_score         double precision,
  original_query_top_score double precision,
  behavioral_rating        integer CHECK (behavioral_rating IS NULL OR behavioral_rating IN (0, 1, 2)),
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_search_logs_user_created
  ON public.search_logs (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.agent_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  role            text NOT NULL,
  content         text NOT NULL DEFAULT '',
  tool_used       text,
  search_log_id   uuid REFERENCES public.search_logs(id) ON DELETE SET NULL,
  sender_id       uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_messages_conversation_id_created_at_idx
  ON public.agent_messages (conversation_id, created_at ASC);

-- Auto-update conversation.updated_at when a message is added (from the
-- unnumbered legacy migration add_agent_conversation_summary.sql, which
-- the apply.mjs runner never runs — folded in here so it actually exists).
CREATE OR REPLACE FUNCTION public.update_agent_conversation_timestamp()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.agent_conversations
  SET updated_at = now()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agent_messages_update_conversation_timestamp ON public.agent_messages;
CREATE TRIGGER agent_messages_update_conversation_timestamp
  AFTER INSERT ON public.agent_messages
  FOR EACH ROW EXECUTE FUNCTION public.update_agent_conversation_timestamp();

CREATE TABLE IF NOT EXISTS public.agent_conversation_entities (
  conversation_id uuid PRIMARY KEY REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  entities        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Feedback messages (read by the unauthenticated insights endpoint — see
-- audit §7.2; the auth gap is a Phase 5 fix, not changed here).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.feedback_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  type       text NOT NULL DEFAULT 'general',
  content    text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_messages_created
  ON public.feedback_messages (created_at DESC);

-- ---------------------------------------------------------------------------
-- Opportunities + matching results (orphaned service: no route calls it
-- today. Created so the service has a table if/when it is wired up, and so
-- a fresh database matches what the code expects.)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.opportunities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  description   text NOT NULL DEFAULT '',
  payment_range text,
  status        text NOT NULL DEFAULT 'pending',
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.matching_results (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  matched_users  jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_matches  integer NOT NULL DEFAULT 0,
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_matching_results_opportunity
  ON public.matching_results (opportunity_id, created_at DESC);

-- ============================================================================
-- RLS
-- ============================================================================
ALTER TABLE public.agent_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_conversation_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.search_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matching_results ENABLE ROW LEVEL SECURITY;

-- Owner-only reads. Writes go through the AI service (service role).
DROP POLICY IF EXISTS "agent_conversations_read_own" ON public.agent_conversations;
CREATE POLICY "agent_conversations_read_own" ON public.agent_conversations
  FOR SELECT USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "agent_messages_read_own" ON public.agent_messages;
CREATE POLICY "agent_messages_read_own" ON public.agent_messages
  FOR SELECT USING (
    conversation_id IN (
      SELECT id FROM public.agent_conversations WHERE user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "agent_conversation_entities_read_own" ON public.agent_conversation_entities;
CREATE POLICY "agent_conversation_entities_read_own" ON public.agent_conversation_entities
  FOR SELECT USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "search_logs_read_own" ON public.search_logs;
CREATE POLICY "search_logs_read_own" ON public.search_logs
  FOR SELECT USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "feedback_messages_read_own" ON public.feedback_messages;
CREATE POLICY "feedback_messages_read_own" ON public.feedback_messages
  FOR SELECT USING (user_id = (SELECT auth.uid()));

-- opportunities / matching_results: no user-facing policy on purpose.
-- Service-role only until a route serves them (Phase 3+ decision).

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification after applying
-- ---------------------------------------------------------------------------
--   SELECT table_name FROM information_schema.tables
--     WHERE table_schema = 'public'
--     AND table_name IN ('agent_conversations','agent_messages',
--       'agent_conversation_entities','search_logs','feedback_messages',
--       'opportunities','matching_results');
--   -- Expect 7 rows. Then, with dummy env, `uv run python -c "import app.main"`
--   -- still passes (no AI code changed in this migration).
