# Budget & split editing before escrow — design

**Date:** 2026-09-16
**Status:** agreed, implementing

## What

A brand can change a one-off (pot) project's budget and the percentage split
across its roles at any point before escrow is funded. Roles whose pence
amount changes are re-opened for the talent to accept; roles whose amount
does not change are left alone and their talent hear nothing.

## Where

A pencil icon on the **Budget** stat tile in the project-admin escrow banner
(`components/tropical/escrow-banner.tsx`). Brand only, pot only, pre-funding
only. It opens an inline editor (`components/tropical/budget-split-editor.tsx`)
in place of the checklist: a budget input in pounds, one slider row per role
(same as the team builder), "Split equally", live £ figures via `splitPot()`,
and a tag on every row that would be re-sent for acceptance. Update / Cancel.

## How

One RPC, one transaction — `tropical_update_budget_split(p_project, p_budget,
p_roles jsonb)` in `migrations/047_tropical_budget_split_edit.sql`:

1. Caller must be `brand_id`; project must be `kind = 'pot'` and `status IN
('draft', 'pending_payment')`.
2. Every role on the project must be present in `p_roles` exactly once —
   the split always sums to the whole pool; there is no partial update.
3. Amounts are recomputed in SQL with the same largest-remainder allocation
   as `lib/money.ts:splitPot()`, so client figures are display-only.
4. `tropical_projects.budget`, each role's `percentage` and `amount` update.
5. A `pending` escrow row from an abandoned checkout is repriced, and each
   of its `held` holds is set to its role's new amount. (Previously those
   holds kept their old amounts forever — the fund RPC only inserts missing
   ones.)
6. For each role whose amount changed AND has an assigned talent AND has a
   contract: `creative_accepted = false`, `status = 'draft'`,
   `brand_accepted = true`; a `contract` message in the role DM from the
   brand; a `contract_updated` notification row for the talent.
7. Returns `{role_id, user_id, role_title, old_amount, new_amount}` for the
   changed roles. The server action emails each of them.

Server action `updateBudgetSplitAction` in `modules/escrow/actions.ts` — the
escrow module owns payment provider and the holds, which is where the hazard is.

## Race with an open checkout

If a `pending` escrow row carries a `checkout_session_id`, the action calls
`payment.checkout.sessions.expire()` on it **before** the RPC. A session that
is already complete cannot be expired — the action then refuses the edit,
because the money for the old figures is on its way. Otherwise the stale
session can never be paid at the old amount and the next "Pay in escrow"
creates a fresh one at the new amount.

## What is deliberately not here

- Adding or removing roles (use the existing member flows).
- Changing the platform fee (a tenant setting).
- Retainers (no pot to split).
- SMS. "Text" here is the role DM message + in-app notification + email,
  matching every other contract change.

## Testing

- `scripts/verify` gains a budget-edit pass (brand seed edits, checks role
  amounts, hold amounts, contract flags, notification rows; the SQL split
  must equal `splitPot()` for 3×33.33 %, one role, and an uneven split).
- Manual in the browser: edit → talent's DM shows the message, bell
  increments, Pay button disables → talent accepts → Pay re-enables.
