-- ============================================================
-- Migration: rename organiser_data → brand_data
-- Also updates the users.role CHECK constraint to use 'brand'
-- Run this in Supabase SQL editor or via CLI
-- ============================================================

BEGIN;

-- 1. Rename the table
ALTER TABLE public.organiser_data RENAME TO brand_data;

-- 2. Rename primary key constraint (actual name in DB: business_data_pkey)
ALTER TABLE public.brand_data RENAME CONSTRAINT business_data_pkey TO brand_data_pkey;

-- 3. Rename unique constraint (actual name in DB: organiser_data_user_id_key)
ALTER TABLE public.brand_data RENAME CONSTRAINT organiser_data_user_id_key TO brand_data_user_id_key;

-- 4. Rename foreign key constraint (actual name in DB: business_data_user_id_fkey)
ALTER TABLE public.brand_data RENAME CONSTRAINT business_data_user_id_fkey TO brand_data_user_id_fkey;

-- 5. Update the role CHECK constraint on users table
--    Drop old constraint and add new one that accepts 'brand' instead of 'organiser'
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
    CHECK (role = ANY (ARRAY['brand'::text, 'creative'::text, 'admin'::text]));

-- 6. Rename any existing 'organiser' role values to 'brand' in existing rows
UPDATE public.users
SET role = 'brand'
WHERE role = 'organiser';

-- 6. Update the column default for role (it defaults to 'creative' so no change needed,
--    but update if you ever added a default of 'organiser')
-- ALTER TABLE public.users ALTER COLUMN role SET DEFAULT 'creative';

COMMIT;
