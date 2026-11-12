import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/supabase';

/**
 * Enforces the retention schedule — see vercel.json for the cadence.
 *
 * A published retention policy that nothing enforces is worse than none: it is
 * a promise on a page and a table that grows forever. This is the thing that
 * makes section 9 of the privacy policy true.
 *
 * The work itself is in tropical_run_retention() (migration 042) rather than
 * here, deliberately. Retention is a set of DELETEs with date predicates, and
 * expressing them as SQL keeps each one atomic and keeps the periods next to
 * the tables they apply to. This route is the trigger and the reporting.
 *
 * What it does NOT delete, and why, is documented on the function: the
 * pre-existing `waitlist` table (production reporting reads it, so purging it
 * is not this job's decision to take), and anything financial or contractual,
 * which is kept for six or seven years because the law requires it and because
 * the other party to an engagement has an equal interest in it.
 *
 * Protected by CRON_SECRET, exactly like the other two crons: there is no
 * signed-in user on a cron invocation, and this route deletes things.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not set' }, { status: 503 });

  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Service role: the function is REVOKEd from anon and authenticated, because
  // nothing a signed-in user does should be able to trigger a bulk delete.
  const { data, error } = await adminDb().rpc('tropical_run_retention');

  if (error) {
    // Logged as well as returned. A retention job that has been failing
    // quietly for six months is indistinguishable from one that never ran, and
    // the cron dashboard only shows the status code. The response itself
    // stays generic: the database error is for the server log, not the
    // caller.
    console.error('retention: tropical_run_retention failed:', error.message);
    return NextResponse.json({ error: 'Retention run failed.' }, { status: 500 });
  }

  const results = (data ?? []) as Array<{ target: string; removed: number }>;
  const removed = results.reduce((sum, r) => sum + Number(r.removed ?? 0), 0);

  return NextResponse.json({ ok: true, removed, detail: results });
}
