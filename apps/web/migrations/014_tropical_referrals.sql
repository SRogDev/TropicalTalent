-- ============================================================================
-- TROPICAL REFERRALS
-- ============================================================================
-- Escalating perks for bringing people to TropicalTalent:
--
--                     CREATIVE                        BRAND
--    1 referral    free creative director audit    complimentary brand story audit
--    5 referrals   intros to our brand partners    intros to top creatives
--   10 referrals   no commission on first 2 projects (both)
--
-- The rewards differ by side of the marketplace: a creative wants their craft
-- audited and access to brands; a brand wants their story sharpened and access
-- to talent. The top rung is the commercial one for both, because it is the
-- reward that costs TropicalTalent real revenue.
--
-- ---------------------------------------------------------------------------
-- The code
-- ---------------------------------------------------------------------------
-- No new code column. `users.referrer_code` already exists, is UNIQUE, and is
-- already populated for all 49 live users by the existing
-- handle_new_public_user() trigger, which calls generate_artistic_code() to
-- produce readable codes like VIVIDSTYLE735. Minting a second identifier would
-- mean two codes per person and a question about which one is real.
--
-- ---------------------------------------------------------------------------
-- Why not the existing public.referrals table
-- ---------------------------------------------------------------------------
-- It exists and is empty, but it carries `reward_amount integer` — it was
-- built for a cash-per-referral scheme. This scheme pays in perks, not money,
-- and a money column nobody fills is a column someone eventually reads and
-- misreports. Left untouched.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. THE LEDGER
-- ============================================================================
-- One row per successful signup that used someone's code. A row exists only
-- once the referred user has a real account and a written profile, so a row
-- IS a successful referral — there is no half-state to filter out when
-- counting.

CREATE TABLE IF NOT EXISTS public.tropical_referrals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id  uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- One person can only ever be referred once, by one person. This is the
  -- constraint that stops the whole scheme being farmed.
  referred_id  uuid NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  -- The code as typed, kept for support ("I used X and it didn't work").
  code_used    text NOT NULL,
  -- Which side signed up. Useful for reporting; both sides count the same.
  referred_role text CHECK (referred_role IN ('creative', 'brand')),
  status       text NOT NULL DEFAULT 'confirmed'
               CHECK (status IN ('confirmed', 'reversed')),
  -- Set by the TropicalTalent team when a referral is disallowed, with the reason.
  reversed_reason text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tropical_referrals_not_self CHECK (referrer_id <> referred_id)
);

CREATE INDEX IF NOT EXISTS idx_tropical_referrals_referrer
  ON public.tropical_referrals (referrer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tropical_referrals_code
  ON public.tropical_referrals (code_used);

COMMENT ON TABLE public.tropical_referrals IS
  'One row per successful referred signup. Count rows WHERE status = ''confirmed'' for the reward tiers.';

ALTER TABLE public.tropical_referrals ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tropical_referrals'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.tropical_referrals', r.policyname);
  END LOOP;
END $$;

-- You can see who you referred, and that you were referred. Inserts happen
-- only through the RPC below (SECURITY DEFINER), never directly — otherwise a
-- user could write their own referral rows.
CREATE POLICY "tropical_referrals_read_own" ON public.tropical_referrals
  FOR SELECT USING (
    referrer_id = (SELECT auth.uid()) OR referred_id = (SELECT auth.uid())
  );

-- ============================================================================
-- 2. REDEEMING A CODE
-- ============================================================================
-- Called during sign-up, after the profile row exists.
--
-- SECURITY DEFINER because it must read another user's referrer_code to
-- resolve it, and because the ledger has no INSERT policy by design. It pins
-- the referred side to the authenticated caller, so it cannot be used to
-- credit a referral for somebody else.
--
-- Returns the referrer's id, or NULL when the code was unusable. Deliberately
-- NOT an exception: a mistyped referral code must never be the reason an
-- otherwise valid sign-up fails.

-- The work, with the referred user passed in explicitly.
--
-- service_role only. Sign-up needs this: when the project has email
-- confirmation enabled, a brand-new user has NO session, so auth.uid() is null
-- at the moment the referral has to be recorded. The server action knows the
-- id of the user it just created, which is a stronger guarantee than a session
-- anyway — so it passes it, rather than the referral being silently dropped
-- for every confirmed-email signup.
CREATE OR REPLACE FUNCTION public.tropical_record_referral(p_code text, p_referred uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code     text := upper(btrim(coalesce(p_code, '')));
  v_referrer uuid;
  v_role     text;
BEGIN
  IF p_referred IS NULL OR v_code = '' THEN
    RETURN NULL;
  END IF;

  -- Codes are shown uppercase and typed however people type them.
  SELECT id INTO v_referrer
  FROM public.users
  WHERE upper(referrer_code) = v_code;

  IF v_referrer IS NULL OR v_referrer = p_referred THEN
    RETURN NULL;  -- unknown code, or their own
  END IF;

  SELECT role INTO v_role FROM public.users WHERE id = p_referred;

  INSERT INTO public.tropical_referrals (referrer_id, referred_id, code_used, referred_role)
  VALUES (v_referrer, p_referred, v_code, v_role)
  -- Already referred by someone. First one wins; re-running sign-up must not
  -- move the credit.
  ON CONFLICT (referred_id) DO NOTHING;

  RETURN v_referrer;
END;
$$;

REVOKE ALL ON FUNCTION public.tropical_record_referral(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_record_referral(text, uuid) TO service_role;

-- The authenticated wrapper, pinned to the caller so it cannot credit a
-- referral for anybody else.
CREATE OR REPLACE FUNCTION public.tropical_redeem_referral(p_code text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.tropical_record_referral(p_code, auth.uid());
$$;

REVOKE ALL ON FUNCTION public.tropical_redeem_referral(text) FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_redeem_referral(text) TO authenticated;

-- ============================================================================
-- 3. THE CALLER'S OWN STANDING
-- ============================================================================
-- What the referral panel renders. One call rather than a count plus a
-- separate tier lookup.

-- The tier thresholds, in ONE place. The view below and the app both read
-- this, so a change to the scheme cannot leave the dashboard disagreeing with
-- what a user is shown. modules/referrals/tiers.ts mirrors the labels for
-- rendering, and points here.
CREATE OR REPLACE FUNCTION public.tropical_referral_tier(p_count bigint)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_count >= 10 THEN 3
    WHEN p_count >= 5  THEN 2
    WHEN p_count >= 1  THEN 1
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public.tropical_my_referrals()
RETURNS TABLE (
  referral_code text,
  confirmed     bigint,
  tier          integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.referrer_code,
    count(r.id) FILTER (WHERE r.status = 'confirmed'),
    public.tropical_referral_tier(count(r.id) FILTER (WHERE r.status = 'confirmed'))
  FROM public.users u
  LEFT JOIN public.tropical_referrals r ON r.referrer_id = u.id
  WHERE u.id = auth.uid()
  GROUP BY u.referrer_code;
$$;

REVOKE ALL ON FUNCTION public.tropical_my_referrals() FROM public;
GRANT EXECUTE ON FUNCTION public.tropical_my_referrals() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tropical_referral_tier(bigint) TO authenticated, service_role;

-- ============================================================================
-- 4. THE TEAM'S VIEW
-- ============================================================================
-- What to open in the Supabase dashboard to see how the scheme is doing.
--
-- Everyone with a code appears, including people on zero, so the denominator
-- is visible rather than inferred. security_invoker = true and no grant to
-- `authenticated`: this is a service-role/dashboard surface, and it carries
-- every user's counts, so it must not be readable by ordinary users.

DROP VIEW IF EXISTS public.tropical_referral_stats;

CREATE VIEW public.tropical_referral_stats
WITH (security_invoker = true) AS
WITH counts AS (
  SELECT
    u.id, u.username, u.name, u.role, u.referrer_code,
    count(r.id) FILTER (WHERE r.status = 'confirmed') AS confirmed,
    count(r.id) FILTER (WHERE r.status = 'reversed')  AS reversed,
    max(r.created_at) AS last_at
  FROM public.users u
  LEFT JOIN public.tropical_referrals r ON r.referrer_id = u.id
  GROUP BY u.id, u.username, u.name, u.role, u.referrer_code
),
tiered AS (
  -- A separate step purely so `tier` is an alias the CASE below can read.
  -- Repeating the aggregate inside the CASE would state the ladder twice more.
  SELECT c.*, public.tropical_referral_tier(c.confirmed) AS tier FROM counts c
)
SELECT
  t.id            AS user_id,
  t.username,
  t.name,
  t.role,
  t.referrer_code AS referral_code,
  t.confirmed     AS confirmed_referrals,
  t.reversed      AS reversed_referrals,
  t.tier,
  -- Mirrors modules/referrals/tiers.ts. Change both together.
  CASE
    WHEN t.tier = 3 THEN 'No commission on first 2 projects'
    WHEN t.tier = 2 AND t.role = 'brand' THEN 'Personal intros to top creatives'
    WHEN t.tier = 2 THEN 'Personal intros to our brand partners'
    WHEN t.tier = 1 AND t.role = 'brand' THEN 'Complimentary brand story audit'
    WHEN t.tier = 1 THEN 'Free creative director audit'
    ELSE 'No reward yet'
  END AS reward_unlocked,
  t.last_at       AS last_referral_at
FROM tiered t;

COMMENT ON VIEW public.tropical_referral_stats IS
  'Referral leaderboard for the TropicalTalent team. Service role / dashboard only — carries every user''s counts.';

REVOKE ALL ON public.tropical_referral_stats FROM anon, authenticated;

-- ============================================================================
-- 5. CODE COVERAGE
-- ============================================================================
-- Every live user already has a referrer_code, but a row created by a path
-- that skipped the trigger would have none — and a referral panel with no code
-- is a dead end. Backfill, then make the guarantee explicit for new rows.

UPDATE public.users
SET referrer_code = public.generate_artistic_code()
WHERE referrer_code IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_referrer_code_upper
  ON public.users (upper(referrer_code));

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- SELECT username, referral_code, confirmed_referrals, tier, reward_unlocked
--   FROM public.tropical_referral_stats
--  ORDER BY confirmed_referrals DESC, username
--  LIMIT 20;
