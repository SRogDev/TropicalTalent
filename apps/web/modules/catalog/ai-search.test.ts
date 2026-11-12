import { describe, expect, test } from 'bun:test';
import { buildAiSearchUrl, shapeAiSearchResults } from './ai-search';

/**
 * AI semantic-search seam (Phase 2).
 *
 * The web never talks to the AI service from the browser. The route
 * handler (`app/api/ai-search/route.ts`) calls the existing AI `GET
 * /search` endpoint server-side, with the user_id taken from the verified
 * session — never from the client's query string, because the AI endpoint
 * takes user_id as a caller-supplied param and is unauthenticated today
 * (audit §7.2). These pure helpers are the testable part of that seam:
 * the URL the handler calls, and the shaping of whatever the AI returns
 * into what the catalog renders.
 */

describe('buildAiSearchUrl', () => {
  test('builds the /search URL with the verified user id and query', () => {
    expect(buildAiSearchUrl('http://127.0.0.1:8000', 'user-1', 'coffee producer')).toBe(
      'http://127.0.0.1:8000/search?user_id=user-1&query=coffee+producer',
    );
  });

  test('a trailing slash on the base does not double the slash', () => {
    expect(buildAiSearchUrl('http://127.0.0.1:8000/', 'u', 'x y')).toBe(
      'http://127.0.0.1:8000/search?user_id=u&query=x+y',
    );
  });

  test('query and user id are encoded', () => {
    expect(buildAiSearchUrl('http://localhost:8000', 'u&1', 'café & té')).toContain(
      'user_id=u%261',
    );
  });
});

describe('shapeAiSearchResults', () => {
  test('shapes a full AI payload into catalog results', () => {
    expect(
      shapeAiSearchResults({
        user_id: 'me',
        query: 'coffee',
        results: [
          {
            user_id: 'u1',
            score: 0.91,
            username: 'cafetalera',
            avatar: null,
            bio: 'Coffee grower',
            tags: ['coffee'],
            passion: 'Coffee',
            metadata: { location: 'Santiago' },
          },
        ],
        total_results: 1,
        results_quality: 'good',
        suggestion_message: null,
      }),
    ).toEqual({
      query: 'coffee',
      quality: 'good',
      suggestion: null,
      results: [
        {
          userId: 'u1',
          score: 0.91,
          username: 'cafetalera',
          avatar: null,
          bio: 'Coffee grower',
          tags: ['coffee'],
          passion: 'Coffee',
        },
      ],
    });
  });

  test('non-array results, missing fields, and wrong types degrade to empty', () => {
    expect(shapeAiSearchResults(null)).toEqual({
      query: '',
      quality: 'good',
      suggestion: null,
      results: [],
    });
    expect(shapeAiSearchResults({ results: 'nope' })).toEqual({
      query: '',
      quality: 'good',
      suggestion: null,
      results: [],
    });
    expect(
      shapeAiSearchResults({
        query: 'x',
        results: [{ user_id: 'u1' }, { score: 0.5 }, null, 'junk'],
      }),
    ).toEqual({
      query: 'x',
      quality: 'good',
      suggestion: null,
      results: [
        { userId: 'u1', score: 0, username: '', avatar: null, bio: null, tags: [], passion: null },
      ],
    });
  });

  test('an unknown quality value falls back to good', () => {
    expect(shapeAiSearchResults({ results_quality: 'stellar', results: [] }).quality).toBe('good');
  });
});
