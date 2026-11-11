-- Migration: Rename portfolio to backstory + Create Living Portfolio
-- Date: 2026-01-16

BEGIN;

-- ============================================
-- PART 1: Rename portfolio to backstory
-- ============================================

-- 1.1 Rename column in creative_data table
ALTER TABLE public.creative_data RENAME COLUMN portfolio TO backstory;

-- ============================================
-- PART 2: Create Living Portfolio (portfolio_items)
-- ============================================

-- 2.1 Create portfolio_items table
CREATE TABLE IF NOT EXISTS public.portfolio_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('image', 'audio', 'document', 'pdf', 'svg')),
  url TEXT NOT NULL,
  filename TEXT,
  file_size INTEGER,
  mime_type TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 2.2 Add comment
COMMENT ON TABLE public.portfolio_items IS 'Living Portfolio items for creative users - supports multiple file types';

-- 2.3 Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_portfolio_items_user_id ON public.portfolio_items(user_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_items_created_at ON public.portfolio_items(created_at DESC);

-- 2.4 Enable Row Level Security
ALTER TABLE public.portfolio_items ENABLE ROW LEVEL SECURITY;

-- 2.5 RLS Policies

-- Everyone can view portfolio items (public profiles)
CREATE POLICY "Portfolio items are viewable by everyone"
  ON public.portfolio_items
  FOR SELECT
  USING (true);

-- Users can insert their own portfolio items
CREATE POLICY "Users can insert their own portfolio items"
  ON public.portfolio_items
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own portfolio items
CREATE POLICY "Users can update their own portfolio items"
  ON public.portfolio_items
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete their own portfolio items
CREATE POLICY "Users can delete their own portfolio items"
  ON public.portfolio_items
  FOR DELETE
  USING (auth.uid() = user_id);

COMMIT;

-- ============================================
-- MANUAL STEPS REQUIRED IN SUPABASE DASHBOARD:
-- ============================================
--
-- 1. Rename storage bucket 'portfolios' to 'backstory':
--    - Go to Storage > portfolios bucket
--    - Download/backup existing files
--    - Create new bucket 'backstory' with same settings
--    - Upload files to new bucket
--    - Delete old bucket (or keep for legacy)
--
-- 2. Create new storage bucket 'user_portfolio':
--    - Go to Storage > New bucket
--    - Name: user_portfolio
--    - Public: Yes
--    - File size limit: 52428800 (50MB)
--
-- 3. Add storage policies for 'user_portfolio' bucket:
--    - SELECT: Allow public read access
--    - INSERT: Allow authenticated users to upload to their folder
--    - DELETE: Allow users to delete their own files
--
-- Example storage policies SQL:
--
-- CREATE POLICY "Public read access for user_portfolio"
-- ON storage.objects FOR SELECT
-- USING (bucket_id = 'user_portfolio');
--
-- CREATE POLICY "Users can upload to their own folder in user_portfolio"
-- ON storage.objects FOR INSERT
-- WITH CHECK (
--   bucket_id = 'user_portfolio'
--   AND auth.uid()::text = (storage.foldername(name))[1]
-- );
--
-- CREATE POLICY "Users can delete their own files in user_portfolio"
-- ON storage.objects FOR DELETE
-- USING (
--   bucket_id = 'user_portfolio'
--   AND auth.uid()::text = (storage.foldername(name))[1]
-- );
--
-- 4. Update existing backstory URLs in creative_data:
--    UPDATE public.creative_data
--    SET backstory = REPLACE(backstory, '/portfolios/', '/backstory/')
--    WHERE backstory IS NOT NULL AND backstory LIKE '%/portfolios/%';
