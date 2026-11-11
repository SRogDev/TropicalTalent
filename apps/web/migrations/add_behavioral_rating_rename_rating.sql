-- Migration: rename 'rating' → 'similarity_score' and add 'behavioral_rating'
--
-- Context:
--   The old 'rating' column was smallint and always NULL because nothing ever wrote to it.
--   We now split the concept in two:
--     - similarity_score (float4): top cosine similarity score from Pinecone, saved at search time.
--     - behavioral_rating (smallint): implicit signal from user actions after the search.
--         0 = bad       (user took no action — reserved for future auto-tagging)
--         1 = good      (user opened a profile from search results)
--         2 = very_good (user sent a message / connection to someone from results)
--
-- Run this in the Supabase SQL editor (or via migration tooling).

-- 1. Rename the column and change its type to float4
ALTER TABLE public.search_logs
  RENAME COLUMN rating TO similarity_score;

ALTER TABLE public.search_logs
  ALTER COLUMN similarity_score TYPE float4
    USING similarity_score::float4;

-- 2. Add the new behavioral_rating column (nullable until user acts)
ALTER TABLE public.search_logs
  ADD COLUMN IF NOT EXISTS behavioral_rating smallint;

-- 3. Index to speed up search_insights queries that filter by behavioral_rating
CREATE INDEX IF NOT EXISTS idx_search_logs_behavioral_rating
  ON public.search_logs (behavioral_rating);

-- 4. Column comments for documentation
COMMENT ON COLUMN public.search_logs.similarity_score IS
  'Top cosine similarity score returned by Pinecone at search time (0.0–1.0). Saved on INSERT.';

COMMENT ON COLUMN public.search_logs.behavioral_rating IS
  'Implicit quality signal from user behaviour after the search. '
  '0 = bad (no action), 1 = good (opened a profile), 2 = very_good (sent message/connection). '
  'NULL until the first interaction event is received from the frontend.';
