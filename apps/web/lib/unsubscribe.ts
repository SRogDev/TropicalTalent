import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * One-click unsubscribe links.
 *
 * A signed token rather than a stored one. The alternative — a random string
 * per recipient in its own table — means a write on every send and a row to
 * expire; this needs neither, because the token IS the proof. It carries the
 * user id and a signature over it, and the only thing that can produce a valid
 * signature is something holding the secret.
 *
 * Deliberately does NOT expire. An unsubscribe link is the one thing in an
 * email that must still work when someone finds the message eighteen months
 * later — an expired opt-out is an opt-out that failed, which is the exact
 * outcome PECR is about. The token grants one narrow power, and nothing else:
 * it can set marketing_enabled to false for one account. It cannot sign in,
 * read anything, or turn marketing back on.
 *
 * Falls back to SUPABASE_SERVICE_ROLE_KEY when no dedicated secret is set, so
 * this works on an existing deployment without a new env var. Set
 * UNSUBSCRIBE_SECRET in production: rotating the service role key would
 * otherwise silently invalidate every unsubscribe link already in an inbox.
 */
function secret(): string | null {
  return process.env.UNSUBSCRIBE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

function sign(userId: string, key: string): string {
  return createHmac('sha256', key).update(`unsubscribe:${userId}`).digest('base64url');
}

/** `<userId>.<signature>`, or null when no secret is configured. */
export function unsubscribeToken(userId: string): string | null {
  const key = secret();
  if (!key) return null;
  return `${userId}.${sign(userId, key)}`;
}

/**
 * The user id a token proves, or null.
 *
 * timingSafeEqual rather than `===`: comparing signatures byte by byte and
 * returning early leaks, over enough attempts, how much of a guess was right.
 */
export function verifyUnsubscribeToken(token: string): string | null {
  const key = secret();
  if (!key) return null;

  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;

  const userId = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  const expected = sign(userId, key);

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // Length is checked first because timingSafeEqual throws on a mismatch. The
  // length of a signature is not a secret — its contents are.
  if (a.length !== b.length) return null;

  return timingSafeEqual(a, b) ? userId : null;
}
