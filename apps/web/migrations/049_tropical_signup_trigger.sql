-- ============================================================================
-- 049 — Fix the auth.users -> public.users trigger
-- ============================================================================
-- APPLY THIS ONE DELIBERATELY. handle_new_user() runs inside the transaction
-- that creates every auth user, so a mistake here does not degrade sign-up, it
-- stops it. Read the diff before running it.
--
-- This function had never been in the repository at all — it was referenced in
-- comments (create_user_records_on_signup.sql:6, identity/actions.ts:146) and
-- existed only in the live database, so the single most important step of
-- onboarding could not be reviewed. It is committed here now, fixes included.
--
-- The previous body, verbatim:
--
--     insert into public.users (id, username, avatar)
--     values (new.id, new.raw_user_meta_data->>'username', null);
--
-- Three problems, all of them visible in the live data:
--
--  1. `avatar` was hard-coded null. Google sends a perfectly good photo as
--     avatar_url (and `picture` on some providers) and it was thrown away on
--     every OAuth sign-up. 10 of 38 creatives have no picture.
--
--  2. `username` came only from raw_user_meta_data->>'username'. The password
--     wizard puts one there; Google does not. So every OAuth account landed
--     with username NULL — four of them in the live database — and NULL is
--     permitted by users_username_unique because Postgres allows many NULLs in
--     a unique constraint, so nothing complained. Those accounts have no
--     working /profile/[username] URL.
--
--  3. `name` was never written, though the metadata carries it.
--
-- The handle fallback derives from the name or the email local-part, matching
-- what uniqueUsername() does in TypeScript (lowercase, non-alphanumeric to _).
-- It appends a short suffix from the uuid rather than checking for collisions:
-- a trigger inside the auth transaction must not loop over a table it is also
-- inserting into, and writeProfile() replaces the handle later anyway. This is
-- only there so the row is never left unreachable.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
-- Advisor: function_search_path_mutable. Without this, whatever schema comes
-- first for the CALLING role decides which `users` this body resolves to.
SET search_path = public
AS $function$
DECLARE
  v_meta     jsonb := COALESCE(new.raw_user_meta_data, '{}'::jsonb);
  v_username text  := NULLIF(btrim(COALESCE(v_meta->>'username', '')), '');
  v_name     text  := NULLIF(btrim(COALESCE(v_meta->>'name', v_meta->>'full_name', '')), '');
  v_avatar   text  := NULLIF(btrim(COALESCE(v_meta->>'avatar_url', v_meta->>'picture', '')), '');
  v_base     text;
BEGIN
  -- No handle supplied (every OAuth sign-up). Derive one so the profile route
  -- is reachable; writeProfile() overwrites it with the real one shortly.
  IF v_username IS NULL THEN
    v_base := lower(COALESCE(v_name, split_part(new.email, '@', 1), 'user'));
    v_base := regexp_replace(v_base, '[^a-z0-9]+', '_', 'g');
    v_base := btrim(v_base, '_');
    IF v_base = '' THEN v_base := 'user'; END IF;
    v_username := left(v_base, 40) || '_' || left(replace(new.id::text, '-', ''), 6);
  END IF;

  INSERT INTO public.users (id, username, name, avatar)
  VALUES (new.id, v_username, v_name, v_avatar)
  -- The app's own profile upsert may have raced ahead of this trigger; that
  -- possibility is exactly why identity/actions.ts:147 uses an upsert. Do not
  -- let a duplicate abort the auth.users insert and fail the whole sign-up.
  ON CONFLICT (id) DO NOTHING;

  RETURN new;
END;
$function$;

-- Called from inside handle_new_public_user() (a SECURITY DEFINER) and reads
-- public.users, so it gets the same treatment. Advisor flags it too.
ALTER FUNCTION public.generate_artistic_code() SET search_path = public;

COMMIT;

-- Verification after applying — create a throwaway user in the dashboard, then:
--   SELECT id, username, name, avatar FROM public.users
--   ORDER BY created_at DESC LIMIT 1;
--   -- username must be non-null; name and avatar populated when the provider
--   -- supplied them.
