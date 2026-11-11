-- ============================================================================
-- TROPICAL REFERRAL REWARD FULFILLMENT
-- ============================================================================
-- 014_tropical_referrals.sql built the ledger and the tier math (1/5/10
-- referrals), but every reward is a human perk — an audit, an intro, a fee
-- waiver — not something the app grants automatically. Nothing has ever
-- recorded whether the TropicalTalent team actually delivered one, so there has been
-- no way to tell "unlocked" from "unlocked and handled". This is that record.
--
-- One row per (user, tier) that has been fulfilled. Absence of a row is the
-- "awaiting" state — deliberately the same no-row-means-outstanding shape as
-- 020's tropical_notification_preferences, just inverted (there, no row means
-- opted in; here, no row means not yet done).
--
-- No RLS policies beyond enabling it: this is an internal ops record, read
-- and written only by the admin dashboard via adminDb(), the same way
-- tropical_disputes has no policy letting anyone but the raiser and adminDb()
-- touch a row.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.tropical_referral_reward_fulfillments (
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tier         integer NOT NULL CHECK (tier IN (1, 2, 3)),
  fulfilled_at timestamptz NOT NULL DEFAULT now(),
  fulfilled_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  note         text,
  PRIMARY KEY (user_id, tier)
);

COMMENT ON TABLE public.tropical_referral_reward_fulfillments IS
  'One row per referral reward tier actually delivered. No row for a tier a user has reached = still owed.';

ALTER TABLE public.tropical_referral_reward_fulfillments ENABLE ROW LEVEL SECURITY;

COMMIT;
