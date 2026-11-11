-- ============================================================
-- Migration: create waitlist table + waitlist-photos storage bucket
-- Backs the pre-launch hype/waitlist landing page signup form.
-- All writes happen server-side (service role) via /api/waitlist,
-- so no client-writable RLS policies are needed on the table.
-- ============================================================

BEGIN;

-- ===========================
-- TABLE: waitlist
-- ===========================
CREATE TABLE IF NOT EXISTS public.waitlist (
  id             uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at     timestamptz DEFAULT now() NOT NULL,
  name           text NOT NULL,
  email          text NOT NULL,
  role           text NOT NULL CHECK (role = ANY (ARRAY['creative'::text, 'brand'::text])),
  company_blurb  text,                                 -- brand only
  photo_url      text,                                 -- creative only
  passion        text,                                 -- creative only, comma-separated selections
  bio            text,                                 -- creative only
  location_id    integer,                              -- creative only, set when resolved via Google Places
  location_text  text,                                 -- creative only, set when entered as plain text instead

  CONSTRAINT waitlist_pkey PRIMARY KEY (id),
  CONSTRAINT waitlist_email_unique UNIQUE (email),
  CONSTRAINT waitlist_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id)
);

COMMENT ON TABLE public.waitlist IS 'Pre-launch waitlist signups collected from the hype landing page';

CREATE INDEX IF NOT EXISTS idx_waitlist_created_at ON public.waitlist (created_at DESC);

-- ===========================
-- RLS (Row Level Security)
-- ===========================
-- No policies: all reads/writes go through the service-role client in
-- app/api/waitlist/route.ts, which bypasses RLS entirely.
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

-- ===========================
-- STORAGE: waitlist-photos bucket
-- ===========================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'waitlist-photos',
  'waitlist-photos',
  true,
  20971520,  -- 20MB in bytes
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Public read so the uploaded photo URLs are usable directly; uploads
-- themselves only ever happen server-side via the service role.
CREATE POLICY "Public read access for waitlist photos"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'waitlist-photos');

COMMIT;
