import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Result shape every server action returns. Callers check `success === true`
 *  explicitly rather than relying on truthiness narrowing. */
export type ActionResult<T = null> = { success: true; data: T } | { success: false; error: string };

export const ok = <T>(data: T): ActionResult<T> => ({ success: true, data });
export const fail = (error: string): ActionResult<never> => ({ success: false, error });

/**
 * PostgREST returns an embedded to-one relation as an array whenever it cannot
 * prove uniqueness. Every embed in this codebase is genuinely to-one, so this
 * collapses both shapes to a single value.
 */
export function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

/** "Motion Designer" -> "motion-designer". Used for new discipline slugs. */
export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/** Public URL for an avatar path, tolerating rows that already hold a URL. */
export function avatarUrl(value: string | null | undefined): string {
  if (!value) return '';
  if (value.startsWith('http') || value.startsWith('blob:') || value.startsWith('data:')) {
    return value;
  }
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  return `${base}/storage/v1/object/public/avatars/${value.replace(/^\/+/, '')}`;
}

/** "14:32" for today, "Mon 14:32" this week, "4 Aug" beyond that. */
export function formatMessageTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';

  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return time;

  const ageDays = (now.getTime() - d.getTime()) / 86_400_000;
  if (ageDays < 7) {
    return `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${time}`;
  }
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** "4 August 2026" — used for date separators between message groups. */
export function formatDayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (d.toDateString() === now.toDateString()) return 'Today';

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';

  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
