-- Migration: add_name_and_username_unique
-- Adds a display `name` field to users, brand_data, and creative_data.
-- `username` remains the unique @handle used for admin/operations.
-- `name` is the human-readable display name shown in the UI.

-- 1. Add name to users table (display name cache, avoids runtime role-check)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS name TEXT;

-- 2. Add name to creative_data
ALTER TABLE public.creative_data
  ADD COLUMN IF NOT EXISTS name TEXT;

-- 3. Add name to brand_data
ALTER TABLE public.brand_data
  ADD COLUMN IF NOT EXISTS name TEXT;

-- 4. Make username unique (it's the @handle identifier)
ALTER TABLE public.users
  ADD CONSTRAINT users_username_unique UNIQUE (username);

-- 5. Backfill: copy existing username value into name for current users
UPDATE public.users
  SET name = username
  WHERE username IS NOT NULL AND name IS NULL;
