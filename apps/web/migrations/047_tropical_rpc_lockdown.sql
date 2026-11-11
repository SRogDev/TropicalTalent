-- ============================================================================
-- 047 — Lock service-role-only RPCs away from anon and authenticated
-- ============================================================================
-- Found by `get_advisors(security)` plus a call-site audit: every function
-- below is SECURITY DEFINER (so it bypasses RLS by design) and performs NO
-- auth.uid() check of its own, because each is only ever invoked by trusted
-- server code — the payment provider webhook, a cron route, or a server action holding
-- the service role. Postgres grants EXECUTE on new functions to PUBLIC by
-- default, so every one of them was also reachable by an unauthenticated
-- caller at /rest/v1/rpc/<name>.
--
-- What that actually allowed, worst case first:
--
--   tropical_mark_escrow_funded  — flips an escrow from 'pending' to 'funded'
--     and the project to 'active' given only its the payment checkout session id.
--     The brand SEES that id in their own return URL, so the exploit needs no
--     guessing: start checkout, copy cs_..., abandon the payment, call this,
--     and the project is funded without payment provider ever taking money.
--
--   tropical_release_period      — credits tropical_user_balances.available (i.e.
--     withdrawable money) for a retainer period, with no check that the caller
--     is the brand who owes it.
--
--   tropical_mark_period_funded  — same trick as mark_escrow_funded, for
--     retainer periods.
--
--   tropical_claim_invite        — takes p_user as an argument, so a caller could
--     claim any tenant invite in someone else's name.
--
--   tropical_record_referral     — takes p_referred, so referral credit could be
--     manufactured for arbitrary accounts.
--
-- REVOKE FROM PUBLIC is the load-bearing line. Revoking from anon and
-- authenticated alone would change nothing, because both inherit the PUBLIC
-- grant. service_role is granted explicitly afterwards.
--
-- Verified safe: every call site already uses adminDb() (service role) —
--   modules/escrow/actions.ts:218, appthe former payment webhook/route.ts:80,106,
--   modules/recurring/billing.ts:332,472, modules/recurring/actions.ts:817,
--   modules/identity/actions.ts:238,582,668.
-- ============================================================================

BEGIN;

REVOKE EXECUTE ON FUNCTION public.tropical_mark_escrow_funded(text, text)  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tropical_mark_period_funded(uuid, text)  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tropical_release_period(uuid)            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tropical_claim_invite(uuid, text, uuid)  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tropical_record_referral(text, uuid)     FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.tropical_mark_escrow_funded(text, text)   TO service_role;
GRANT EXECUTE ON FUNCTION public.tropical_mark_period_funded(uuid, text)   TO service_role;
GRANT EXECUTE ON FUNCTION public.tropical_release_period(uuid)             TO service_role;
GRANT EXECUTE ON FUNCTION public.tropical_claim_invite(uuid, text, uuid)   TO service_role;
GRANT EXECUTE ON FUNCTION public.tropical_record_referral(text, uuid)      TO service_role;

-- tropical_release_all_delivered is deliberately NOT revoked from authenticated.
--
-- It is the one function in this group a real user calls directly
-- (releaseAllDeliveredRolesAction, modules/escrow/actions.ts:342, through the
-- user's own db() client). It looks unguarded — it has no auth.uid() of its own
-- — but it is not: it loops over delivered roles and delegates each one to
-- tropical_release_role(), which raises 42501 unless auth.uid() is the project's
-- brand. An anonymous caller gets 'not authenticated' from the same check.
--
-- Revoked from anon anyway: reaching a paid-work function at all, only to be
-- refused one frame later by a guard in a different function, is a larger
-- surface than this needs.
REVOKE EXECUTE ON FUNCTION public.tropical_release_all_delivered(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.tropical_release_all_delivered(uuid) TO authenticated, service_role;

COMMIT;

-- Verification after applying:
--   SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname LIKE 'tropical_%';
--   -- every row above must read false for anon.
