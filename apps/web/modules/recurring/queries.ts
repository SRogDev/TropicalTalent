import 'server-only';

import { cache } from 'react';
import { db } from '@/lib/supabase';
import type { BillingProfile, RolePeriod, RecurringTerms } from './types';

/**
 * Reads for recurring engagements.
 *
 * Both parties see the same schedule — RLS on tropical_role_periods allows the
 * assigned talent, the brand, and project members. That is deliberate: the
 * entire value of a retainer to the person earning it is knowing what lands
 * and when, and putting that behind the brand's view would make this a worse
 * deal than a fixed-price job.
 */

interface PeriodRow {
  id: string;
  role_id: string;
  project_id: string;
  creative_id: string | null;
  period_start: string;
  period_end: string;
  gross: number;
  platform_fee: number;
  partner_fee: number;
  net: number;
  status: string;
  failure_reason: string | null;
  attempts: number;
  released_at: string | null;
}

function toPeriod(r: PeriodRow): RolePeriod {
  return {
    id: r.id,
    roleId: r.role_id,
    projectId: r.project_id,
    creativeId: r.creative_id,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    gross: r.gross,
    platformFee: r.platform_fee,
    partnerFee: r.partner_fee,
    net: r.net,
    status: r.status as RolePeriod['status'],
    failureReason: r.failure_reason,
    attempts: r.attempts,
    releasedAt: r.released_at,
  };
}

/**
 * Every period on a project, newest first.
 *
 * One query for the whole project rather than one per role: a workspace shows
 * all of them together, and per-role fetching is the N+1 this codebase's
 * conventions exist to prevent.
 */
export const loadProjectPeriods = cache(async (projectId: string): Promise<RolePeriod[]> => {
  const supabase = await db();
  const { data } = await supabase
    .from('tropical_role_periods')
    .select(
      'id, role_id, project_id, creative_id, period_start, period_end, gross, platform_fee, partner_fee, net, status, failure_reason, attempts, released_at',
    )
    .eq('project_id', projectId)
    .order('period_start', { ascending: false })
    .limit(200);

  return ((data ?? []) as PeriodRow[]).map(toPeriod);
});

/** The schedule attached to each recurring role on a project. */
export const loadRecurringTerms = cache(
  async (projectId: string): Promise<Record<string, RecurringTerms>> => {
    const supabase = await db();
    const { data } = await supabase
      .from('tropical_project_roles')
      .select(
        'id, pay_model, period, period_amount, approval, next_period_start, ends_at, paused_at, approval_confirmed_at, activated_at, card_setup_status, card_setup_started_at, card_setup_error',
      )
      .eq('project_id', projectId)
      .eq('pay_model', 'recurring');

    return Object.fromEntries(
      (data ?? []).map((r) => [
        r.id as string,
        {
          payModel: 'recurring' as const,
          period: r.period as RecurringTerms['period'],
          periodAmount: r.period_amount as number | null,
          approval: (r.approval ?? 'auto') as RecurringTerms['approval'],
          nextPeriodStart: r.next_period_start as string | null,
          endsAt: r.ends_at as string | null,
          pausedAt: r.paused_at as string | null,
          approvalConfirmedAt: r.approval_confirmed_at as string | null,
          activatedAt: r.activated_at as string | null,
          cardSetupStatus: (r.card_setup_status ?? null) as RecurringTerms['cardSetupStatus'],
          cardSetupStartedAt: r.card_setup_started_at as string | null,
          cardSetupError: r.card_setup_error as string | null,
        },
      ]),
    );
  },
);

/**
 * The talent's own upcoming and recent pay, across every engagement.
 *
 * This is the answer to "when am I next paid", which for someone treating
 * this as income is the single most important question the app can answer.
 */
export const loadMyPeriods = cache(async (userId: string): Promise<RolePeriod[]> => {
  const supabase = await db();
  const { data } = await supabase
    .from('tropical_role_periods')
    .select(
      'id, role_id, project_id, creative_id, period_start, period_end, gross, platform_fee, partner_fee, net, status, failure_reason, attempts, released_at',
    )
    .eq('creative_id', userId)
    .order('period_start', { ascending: false })
    .limit(50);

  return ((data ?? []) as PeriodRow[]).map(toPeriod);
});

/**
 * The card the brand has on file for this workspace.
 *
 * Read through the caller's own session: tropical_billing_profiles has exactly
 * one policy, `brand_id = auth.uid()`, so a brand can only ever see their own
 * — and passing the tenant explicitly keeps the same person's two white-label
 * relationships from being read as one.
 *
 * This exists because a brand had no way to tell whether their card had
 * saved. The pay run knew, the payment provider dashboard knew, and the only surface
 * that could have told them showed nothing either way.
 */
export const loadBillingProfile = cache(
  async (brandId: string, tenantId: string): Promise<BillingProfile> => {
    const supabase = await db();
    const { data } = await supabase
      .from('tropical_billing_profiles')
      .select(
        'default_payment_method, card_brand, card_last4, card_exp_month, card_exp_year, updated_at',
      )
      .eq('brand_id', brandId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    return {
      hasCard: Boolean(data?.default_payment_method),
      cardBrand: (data?.card_brand as string | null) ?? null,
      cardLast4: (data?.card_last4 as string | null) ?? null,
      cardExpMonth: (data?.card_exp_month as number | null) ?? null,
      cardExpYear: (data?.card_exp_year as number | null) ?? null,
      updatedAt: (data?.updated_at as string | null) ?? null,
    };
  },
);
