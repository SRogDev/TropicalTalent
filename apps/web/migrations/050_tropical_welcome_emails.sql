-- ============================================================================
-- 050 — Remember who has been sent a welcome email
-- ============================================================================
-- The welcome has to be sent from more than one place, because sign-up does not
-- finish in one place:
--
--   * password sign-up with email confirmation OFF  -> a session exists at the
--     end of signUpAction, so it can go out immediately;
--   * password sign-up with confirmation ON         -> there is no session, the
--     account is not usable yet, and a welcome arriving beside "confirm your
--     address" competes with the one mail that has to be acted on. It goes out
--     from /auth/callback once the link is clicked;
--   * Google                                        -> completeProfileAction.
--
-- Confirmation is ON for this project (34 of the last 35 sign-ups confirmed a
-- median half-minute after creating the account, none instantly), so the
-- callback path is the normal one, not the exception.
--
-- /auth/callback also runs on every subsequent sign-in, so "have we already
-- welcomed this person" needs an answer that survives. This table is it.
--
-- A tropical_ table rather than a column on public.users: users is one of the
-- pre-existing identity tables this codebase reads but never migrates (see
-- claude.md, "Database"), and a welcome flag is this app's bookkeeping, not
-- part of the identity record.
--
-- Claiming is the INSERT itself. `ON CONFLICT DO NOTHING ... RETURNING user_id`
-- returns a row only to the caller that actually inserted, so two concurrent
-- attempts cannot both send — no read-then-write window to lose.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.tropical_welcome_emails (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now(),
  -- Which site's branding they were welcomed with. A person can hold
  -- memberships in several tenants; they are welcomed once, by the first.
  tenant_id uuid REFERENCES public.tropical_tenants(id) ON DELETE SET NULL
);

-- Written and read only through the service role (sendWelcomeEmail runs with
-- adminDb(), on the confirmation path there is no session at all). RLS on with
-- no policy is deny-all for anon and authenticated, which is the intent —
-- same pattern as tropical_deleted_accounts.
ALTER TABLE public.tropical_welcome_emails ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.tropical_welcome_emails TO service_role;

-- Everyone who already has an account has already had whatever onboarding they
-- were going to get; back-filling them all would mean 50 people receiving a
-- "welcome" for an account they have been using for months.
INSERT INTO public.tropical_welcome_emails (user_id, sent_at)
SELECT id, now() FROM public.users
ON CONFLICT (user_id) DO NOTHING;

COMMIT;

-- Verification after applying:
--   SELECT count(*) FROM public.tropical_welcome_emails;  -- equals users count
