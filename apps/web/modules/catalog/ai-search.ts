/**
 * AI semantic-search seam (Phase 2) — pure helpers.
 *
 * The web never talks to the AI service from the browser. The route
 * handler (`app/api/ai-search/route.ts`) calls the existing AI `GET
 * /search` endpoint server-side. These helpers are the testable part of
 * that seam: the URL the handler calls, and the shaping of whatever the
 * AI returns into what the catalog renders.
 *
 * Two things the handler enforces that live here as documentation, not
 * code: the `user_id` in the URL is the verified session user, never a
 * client-supplied value (the AI endpoint takes user_id as a caller
 * param and is unauthenticated today — audit §7.2); and the AI base URL
 * comes from `CUBORA_AI_BASE_URL`, never from the client.
 */

export interface AiSearchResult {
  userId: string;
  score: number;
  username: string;
  avatar: string | null;
  bio: string | null;
  tags: string[];
  passion: string | null;
}

export interface AiSearchShaped {
  query: string;
  quality: 'excellent' | 'good' | 'marginal' | 'poor';
  suggestion: string | null;
  results: AiSearchResult[];
}

export function buildAiSearchUrl(baseUrl: string, userId: string, query: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const params = new URLSearchParams({ user_id: userId, query });
  return `${base}/search?${params.toString()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Shape an AI /search payload into what the catalog renders. The AI
 * contract is `apps/ai/app/models/search.py` (SearchResponse); anything
 * missing or wrong-typed degrades to an empty result, never to a crash —
 * a search backend that changes shape must not take the catalog down
 * with it, and it must never fabricate a result.
 */
export function shapeAiSearchResults(payload: unknown): AiSearchShaped {
  const empty: AiSearchShaped = { query: '', quality: 'good', suggestion: null, results: [] };
  if (!isRecord(payload)) return empty;

  const query = typeof payload.query === 'string' ? payload.query : '';
  const qualityRaw = typeof payload.results_quality === 'string' ? payload.results_quality : 'good';
  const quality: AiSearchShaped['quality'] =
    qualityRaw === 'excellent' ||
    qualityRaw === 'good' ||
    qualityRaw === 'marginal' ||
    qualityRaw === 'poor'
      ? qualityRaw
      : 'good';
  const suggestion =
    typeof payload.suggestion_message === 'string' ? payload.suggestion_message : null;

  const rawResults = Array.isArray(payload.results) ? payload.results : [];
  const results: AiSearchResult[] = [];
  for (const item of rawResults) {
    if (!isRecord(item) || typeof item.user_id !== 'string') continue;
    results.push({
      userId: item.user_id,
      score: typeof item.score === 'number' && Number.isFinite(item.score) ? item.score : 0,
      username: typeof item.username === 'string' ? item.username : '',
      avatar: typeof item.avatar === 'string' ? item.avatar : null,
      bio: typeof item.bio === 'string' ? item.bio : null,
      tags: Array.isArray(item.tags)
        ? item.tags.filter((t): t is string => typeof t === 'string')
        : [],
      passion: typeof item.passion === 'string' ? item.passion : null,
    });
  }

  return { query, quality, suggestion, results };
}
