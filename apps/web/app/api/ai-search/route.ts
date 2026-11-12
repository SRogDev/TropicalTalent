import { NextResponse } from 'next/server';
import { getViewer } from '@/modules/identity/queries';
import { buildAiSearchUrl, shapeAiSearchResults } from '@/modules/catalog/ai-search';

/**
 * GET /api/ai-search?q=…
 *
 * Thin server-side seam to the AI service's existing `GET /search`
 * endpoint (Phase 2, data-model.md §5). The browser never talks to the
 * AI service and never sees a service key: this handler is the only
 * caller, it runs server-side, and the `user_id` it sends is the verified
 * session user — never a client-supplied value.
 *
 * Known issue (audit §7.2, Phase 5): the AI `/search` endpoint is
 * unauthenticated today. Calling it server-side only narrows the
 * exposure to this handler; it does not authenticate the call. Phase 2
 * invents no auth for it.
 *
 * The AI service is optional in this build: with `CUBORA_AI_BASE_URL`
 * unset, or the service unreachable, the handler answers 503 with a
 * plain message and the catalog falls back to structured search.
 */
export async function GET(request: Request) {
  const viewer = await getViewer();
  if (!viewer) {
    return NextResponse.json({ error: 'You need to be signed in.' }, { status: 401 });
  }

  const q = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  if (q.length < 3 || q.length > 500) {
    return NextResponse.json({ error: 'Search needs 3–500 characters.' }, { status: 400 });
  }

  const baseUrl = process.env.CUBORA_AI_BASE_URL?.trim();
  if (!baseUrl) {
    return NextResponse.json({ error: 'Semantic search is not configured yet.' }, { status: 503 });
  }

  let response: Response;
  try {
    response = await fetch(buildAiSearchUrl(baseUrl, viewer.id, q), {
      // The AI call is the slow part of this request; fail fast rather
      // than hang the catalog.
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return NextResponse.json(
      { error: 'Semantic search is unavailable right now.' },
      { status: 503 },
    );
  }

  if (!response.ok) {
    return NextResponse.json(
      { error: 'Semantic search is unavailable right now.' },
      { status: 503 },
    );
  }

  const payload: unknown = await response.json().catch(() => null);
  return NextResponse.json(shapeAiSearchResults(payload));
}
