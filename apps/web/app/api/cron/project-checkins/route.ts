import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/supabase';
import { sendNotificationEmail } from '@/modules/notifications/email';

/**
 * Weekly check-in digest for every active project — see vercel.json for the
 * schedule. Not an event, so it has no server action to hang off; this is
 * its own entry point, called by Vercel Cron rather than a user.
 *
 * Protected by CRON_SECRET rather than a session: there is no signed-in user
 * on a cron invocation. Vercel sends `Authorization: Bearer <CRON_SECRET>`
 * automatically once the env var is set on the project, so this check is
 * what stops anyone else from hitting the route and triggering a mass email.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not set' }, { status: 503 });

  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = adminDb();

  const { data: projects, error } = await admin
    .from('tropical_projects')
    .select(
      `
      id, name, created_at, tenant_id,
      members:tropical_project_members(user_id),
      roles:tropical_project_roles(status, pay_model),
      deliverables:tropical_deliverables(id)
    `,
    )
    .eq('status', 'active');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let emailed = 0;

  await Promise.all(
    (projects ?? []).map(async (project) => {
      const days = Math.max(
        0,
        Math.floor((Date.now() - new Date(project.created_at).getTime()) / 86_400_000),
      );
      const roles = (project.roles ?? []) as Array<{ status: string; pay_model?: string }>;

      // A retainer runs for months, and this digest fires weekly. Left alone,
      // a twelve-month engagement would send its members fifty-two near
      // identical "still active" emails — the fastest way to teach people to
      // filter everything this app sends.
      //
      // Recurring projects get their signal from the pay run instead: funded,
      // released, or a funding problem. Those are events; this is a heartbeat,
      // and a heartbeat is only news when the thing is short-lived.
      if (roles.some((r) => r.pay_model === 'recurring')) return;
      const awaitingRelease = roles.filter((r) => r.status === 'delivered').length;
      const inProgress = roles.filter((r) => r.status === 'accepted').length;
      const deliverableCount = (project.deliverables ?? []).length;

      const subject = `Check-in - ${project.name}`;
      const body = [
        `${project.name} has been active for ${days} day${days === 1 ? '' : 's'}.`,
        `${deliverableCount} deliverable${deliverableCount === 1 ? '' : 's'} defined.`,
        `${inProgress} role${inProgress === 1 ? '' : 's'} in progress.`,
        awaitingRelease > 0
          ? `${awaitingRelease} role${awaitingRelease === 1 ? '' : 's'} delivered and awaiting your release.`
          : null,
      ]
        .filter(Boolean)
        .join(' ');

      const members = (project.members ?? []) as Array<{ user_id: string }>;
      await Promise.all(
        members.map((m) =>
          sendNotificationEmail({
            userId: m.user_id,
            kind: 'project_checkin',
            subject,
            body,
            path: `/projects/${project.id}`,
            // A cron's Host header is the deployment's own, which resolves to
            // classic — so without this a white-label's digest goes out in
            // TropicalTalent's colours with a TropicalTalent link.
            tenantId: project.tenant_id,
          }),
        ),
      );
      emailed += members.length;
    }),
  );

  return NextResponse.json({ projects: projects?.length ?? 0, emailed });
}
