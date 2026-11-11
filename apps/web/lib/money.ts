/**
 * Money arithmetic. Every amount is an integer number of pence.
 *
 * The hard requirement: when a pot is split across roles plus a platform fee,
 * the parts must sum to EXACTLY the pot. Rounding each share independently
 * does not satisfy that — three roles at 33.33% of 1000p each round to 333p
 * and lose a penny, which would strand money in escrow and make the project
 * un-releasable. `allocate()` uses largest-remainder so the total is exact.
 *
 * The same function runs on the client (live figures in the team builder) and
 * on the server (the amounts actually written), so what the brand sees is
 * what gets stored.
 */

export const CURRENCY = 'GBP';

/** TropicalTalent's cut of the pot. */
export const DEFAULT_PLATFORM_FEE_PCT = 15;

export interface RoleShare {
  id: string;
  percentage: number;
}

export interface PotSplit {
  /** The whole pot, pence. */
  budget: number;
  /** What TropicalTalent keeps, pence. */
  platformFee: number;
  /** What the crew shares, pence. budget - platformFee. */
  crewPool: number;
  roles: Array<{ id: string; percentage: number; amount: number }>;
}

/**
 * Distributes `total` pence across `weights`, exactly.
 *
 * Leftover pence go to the entries with the largest fractional parts, so they
 * land on the biggest earners rather than being dropped. Ties break on the
 * larger share then on index, making the result deterministic.
 */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map(() => 0);

  const exact = weights.map((w) => (total * w) / sum);
  const out = exact.map(Math.floor);
  let remainder = total - out.reduce((a, b) => a + b, 0);

  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value), value }))
    .sort((a, b) => b.frac - a.frac || b.value - a.value || a.index - b.index);

  for (let i = 0; remainder > 0; i = (i + 1) % order.length) {
    out[order[i].index] += 1;
    remainder -= 1;
  }
  return out;
}

/**
 * Splits `budget` pence into a platform fee plus one share per role.
 *
 * Role percentages are shares of the CREW POOL (the pot after the fee), which
 * is what the sliders in the team builder represent.
 *
 * Guarantees platformFee + sum(roles.amount) === budget for any input.
 */
export function splitPot(
  budget: number,
  roles: RoleShare[],
  platformFeePct: number = DEFAULT_PLATFORM_FEE_PCT,
): PotSplit {
  if (!Number.isInteger(budget)) {
    throw new Error(`budget must be a whole number of pence, got ${budget}`);
  }
  if (budget < 0) throw new Error('budget must not be negative');
  if (platformFeePct < 0 || platformFeePct >= 100) {
    throw new Error('platformFeePct must be in [0, 100)');
  }

  // Round the fee down so the crew is never short-changed by rounding.
  const platformFee = Math.floor((budget * platformFeePct) / 100);
  const crewPool = budget - platformFee;

  if (roles.length === 0) return { budget, platformFee, crewPool, roles: [] };

  const totalPct = roles.reduce((sum, r) => sum + r.percentage, 0);
  if (totalPct <= 0) throw new Error('role percentages must sum to more than 0');

  const amounts = allocate(
    crewPool,
    roles.map((r) => r.percentage),
  );

  return {
    budget,
    platformFee,
    crewPool,
    roles: roles.map((r, i) => ({ id: r.id, percentage: r.percentage, amount: amounts[i] })),
  };
}

/** 1800000 -> "£18,000". Whole pounds when exact, two decimals otherwise. */
export function formatPence(pence: number, currency: string = CURRENCY, locale = 'en-GB'): string {
  const hasFraction = pence % 100 !== 0;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: hasFraction ? 2 : 0,
  }).format(pence / 100);
}

/**
 * "18000", "£18,000" or 18000 -> 1800000 pence.
 *
 * Throws on input with no digits. Stripping non-numerics from "abc" leaves ""
 * and Number("") is 0 — without this guard a typo in the budget field would
 * silently create a project with a zero pot.
 */
export function poundsToPence(pounds: number | string): number {
  let n: number;
  if (typeof pounds === 'string') {
    const cleaned = pounds.replace(/[^0-9.-]/g, '');
    if (!/\d/.test(cleaned)) throw new Error(`not a number: ${pounds}`);
    n = Number(cleaned);
  } else {
    n = pounds;
  }
  if (!Number.isFinite(n)) throw new Error(`not a number: ${pounds}`);
  return Math.round(n * 100);
}
