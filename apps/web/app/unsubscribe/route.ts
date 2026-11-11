import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/supabase';
import { verifyUnsubscribeToken } from '@/lib/unsubscribe';

/**
 * One-click unsubscribe.
 *
 * Public and unauthenticated by necessity: the whole point is that it works
 * from an inbox, on a device with no session, without anyone having to sign in
 * to stop email they did not ask for. The signed token is the authorisation —
 * see lib/unsubscribe.ts for why it is signed rather than stored.
 *
 * Both verbs, and that is not a nicety:
 *
 *   GET   the link a person clicks.
 *   POST  what a mail client calls by itself, because the messages carry
 *         List-Unsubscribe-Post. Gmail and Apple Mail show their own
 *         "Unsubscribe" control next to the sender and call this directly, so
 *         a GET-only route means that button appears and silently does nothing.
 *
 * Sets marketing_enabled only. It must never touch email_enabled: unsubscribing
 * from a re-engagement nudge cannot be allowed to stop "your payout completed".
 * That coupling is the thing migration 042 exists to break.
 */
async function unsubscribe(token: string): Promise<boolean> {
  const userId = verifyUnsubscribeToken(token);
  if (!userId) return false;

  // Service role: there is no session here by design, and the row belongs to
  // someone who is not present. The token is what authorises it.
  const { error } = await adminDb().from('tropical_notification_preferences').upsert(
    {
      user_id: userId,
      marketing_enabled: false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );

  return !error;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const token = new URL(request.url).searchParams.get('t') ?? '';
  const ok = await unsubscribe(token);
  // A mail client is not reading prose. Status is the whole answer.
  return NextResponse.json({ ok }, { status: ok ? 200 : 400 });
}

export async function GET(request: NextRequest): Promise<Response> {
  const token = new URL(request.url).searchParams.get('t') ?? '';
  const ok = await unsubscribe(token);

  // A whole page, rather than a redirect into the app, because the person
  // clicking this is by definition not signed in and may not want to be. It
  // has to render on its own and say plainly what did and did not change.
  const body = ok
    ? `<h1>You're unsubscribed</h1>
       <p>We won't send you any more marketing email.</p>
       <p class="note">You'll still get the emails about your account - work delivered,
       payments released, disputes raised. Those aren't marketing, and you can
       manage them on your profile page.</p>`
    : `<h1>That link didn't work</h1>
       <p>It may have been altered in transit, or copied incompletely.</p>
       <p class="note">You can turn marketing email off yourself from your profile page,
       or reply to any email from us and we'll do it.</p>`;

  return new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${ok ? 'Unsubscribed' : 'Link not recognised'}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:32px;
         font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
         background:#f5f5f5; color:#18181b; }
  main { max-width:420px; background:#fff; border-radius:12px; padding:32px; }
  h1 { font-size:20px; margin:0 0 12px; }
  p { font-size:14px; line-height:1.6; color:#3f3f46; margin:0 0 12px; }
  p.note { font-size:12px; color:#71717a; margin-bottom:0; }
  @media (prefers-color-scheme: dark) {
    body { background:#09090b; color:#fafafa; }
    main { background:#18181b; }
    p { color:#a1a1aa; }
    p.note { color:#71717a; }
  }
</style>
</head>
<body><main>${body}</main></body>
</html>`,
    {
      status: ok ? 200 : 400,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    },
  );
}
