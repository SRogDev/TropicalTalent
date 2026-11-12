import { NextResponse } from 'next/server';
import { getViewer } from '@/modules/identity/queries';
import { db } from '@/lib/supabase';

/**
 * POST /api/discovery — server-side proxy to the AI discovery agent.
 *
 * The browser never talks to the AI service and never sees a service
 * key: this handler is the only caller. It forwards the signed-in
 * user's own Supabase JWT (from the verified session, never from the
 * request body) so the AI's POST /api/agent can authenticate the call
 * with its usual `get_current_user` dependency.
 *
 * The AI streams structured SSE events (docs/architecture/
 * ai-orchestration.md §2, O12 contract): text, clarification prompts,
 * offer cards, sourcing-request events. The handler streams the
 * response through untouched — parsing lives in the client component
 * (`modules/discovery/events.ts`).
 *
 * The AI service is optional in this build: with `CUBORA_AI_BASE_URL`
 * unset, or the service unreachable, the handler answers 503 and the
 * discovery page falls back to a plain message + a link to /catalog.
 */
export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer) {
    return NextResponse.json({ error: 'You need to be signed in.' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }
  const payload = (body ?? {}) as Record<string, unknown>;
  const message = typeof payload.message === 'string' ? payload.message.trim() : '';
  const conversationId =
    typeof payload.conversation_id === 'string' ? payload.conversation_id : null;
  if (message.length < 1 || message.length > 2000) {
    return NextResponse.json({ error: 'Message needs 1–2000 characters.' }, { status: 400 });
  }

  const baseUrl = process.env.CUBORA_AI_BASE_URL?.trim();
  if (!baseUrl) {
    return NextResponse.json({ error: 'AI discovery is not configured yet.' }, { status: 503 });
  }

  const supabase = await db();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return NextResponse.json({ error: 'You need to be signed in.' }, { status: 401 });
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/agent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        message,
        ...(conversationId ? { conversation_id: conversationId } : {}),
      }),
      // Discovery turns run a graph + model calls; fail fast rather
      // than hang the chat.
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    return NextResponse.json(
      { error: 'AI discovery is unavailable right now.' },
      { status: 503 },
    );
  }

  if (!response.ok || !response.body) {
    return NextResponse.json(
      { error: 'AI discovery is unavailable right now.' },
      { status: 503 },
    );
  }

  return new Response(response.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
