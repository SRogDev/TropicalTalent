-- Migration: fix_brand_role_and_table
-- Idempotent fixes for brand onboarding.
-- Safe to run even if rename_organiser_data_to_brand_data.sql was already partially applied.
--
-- 1. Ensure the role CHECK constraint allows 'brand'
-- 2. Migrate any remaining 'organiser' rows to 'brand'
-- 3. Ensure brand_data table exists with the correct structure

-- 1. Update role CHECK constraint to allow 'brand' instead of (or alongside) 'organiser'
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
    CHECK (role = ANY (ARRAY['brand'::text, 'creative'::text, 'admin'::text]));

-- 2. Migrate any existing 'organiser' role values to 'brand'
UPDATE public.users SET role = 'brand' WHERE role = 'organiser';

-- 3. Ensure brand_data table exists (handles case where migration was never run
--    or organiser_data was never renamed)
CREATE TABLE IF NOT EXISTS public.brand_data (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id     uuid        UNIQUE REFERENCES public.users(id),
  type        text,
  name        text,
  expectation text,
  budget      numeric,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_data_pkey PRIMARY KEY (id)
);
