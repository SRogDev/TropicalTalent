'use client';

import { useState } from 'react';
import { ExternalLink, Play } from 'lucide-react';

/**
 * The showreel player.
 *
 * The previous version rendered every showreel as a bare <a> to the raw URL —
 * "video player rendering and source URL binding" was broken because there was
 * no player at all, only a link, and it appeared on the profile page only.
 * Brands reviewing a talent had nothing to watch.
 *
 * What this does:
 *
 *   * Recognises YouTube (watch, youtu.be, shorts, embed) and Vimeo URLs and
 *     builds a proper embed src. Handing a watch?v= URL to an <iframe> is what
 *     the old "source URL binding" bug was — YouTube refuses to frame it.
 *   * Serves a direct video file through <video> instead of an iframe.
 *   * Falls back to a labelled outbound link for anything unrecognised, rather
 *     than an empty black box.
 *   * Loads the iframe only after a click. Ten profile cards each mounting a
 *     YouTube iframe on render is ~10MB of third-party script before the brand
 *     has watched anything.
 */

type Embed =
  | { kind: 'iframe'; src: string; title: string }
  | { kind: 'video'; src: string }
  /** Not embeddable. `label` says what it actually is. */
  | { kind: 'link'; href: string; label: string };

export function resolveShowreel(rawUrl: string): Embed | null {
  const url = rawUrl?.trim();
  if (!url) return null;

  let parsed: URL;
  try {
    parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./, '');

  // --- YouTube ---
  if (host === 'youtu.be') {
    const id = parsed.pathname.slice(1).split('/')[0];
    if (id) return youtube(id, parsed.searchParams.get('t'));
  }
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
    const v = parsed.searchParams.get('v');
    if (v) return youtube(v, parsed.searchParams.get('t'));

    // /shorts/<id>, /embed/<id>, /live/<id>
    const match = parsed.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]+)/);
    if (match) return youtube(match[1], null);

    // A CHANNEL, not a video — /@handle, /c/x, /channel/x, /user/x. Several
    // live profiles link one. YouTube has no embed for a channel, so this
    // cannot be a player; say what it is instead of showing a dead frame.
    const channel = parsed.pathname.match(/^\/(@[\w.-]+|c\/[\w.-]+|channel\/[\w-]+|user\/[\w.-]+)/);
    if (channel) {
      return {
        kind: 'link',
        href: parsed.toString(),
        label: channel[1].startsWith('@') ? `YouTube · ${channel[1]}` : 'YouTube channel',
      };
    }
  }

  // --- Vimeo ---
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const match = parsed.pathname.match(/(\d{6,})/);
    if (match) {
      return {
        kind: 'iframe',
        src: `https://player.vimeo.com/video/${match[1]}`,
        title: 'Vimeo showreel',
      };
    }
  }

  // --- A direct file ---
  if (/\.(mp4|webm|ogv|mov|m4v)$/i.test(parsed.pathname)) {
    return { kind: 'video', src: parsed.toString() };
  }

  // Anything else — a portfolio site, a Behance page. Show the host, not a
  // 60-character URL truncated into meaninglessness.
  return { kind: 'link', href: parsed.toString(), label: host };
}

function youtube(id: string, start: string | null): Embed {
  const params = new URLSearchParams({ autoplay: '1', rel: '0', modestbranding: '1' });
  // "90s" / "1m30s" / "45" all appear in shared links.
  const seconds = start ? parseTimestamp(start) : 0;
  if (seconds > 0) params.set('start', String(seconds));

  return {
    kind: 'iframe',
    // nocookie so a profile view does not set a YouTube tracking cookie.
    src: `https://www.youtube-nocookie.com/embed/${id}?${params}`,
    title: 'YouTube showreel',
  };
}

function parseTimestamp(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  const match = value.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
  if (!match) return 0;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

export function ShowreelPlayer({
  url,
  className = '',
}: {
  url: string | null | undefined;
  className?: string;
}) {
  const [playing, setPlaying] = useState(false);
  const embed = url ? resolveShowreel(url) : null;

  if (!embed) return null;

  if (embed.kind === 'link') {
    return (
      <a
        href={embed.href}
        target='_blank'
        rel='noopener noreferrer'
        className={`glass hover:border-foreground/20 flex items-center gap-3 rounded-xl px-4 py-3 text-sm transition ${className}`}
      >
        <span className='bg-gradient-brand text-on-brand grid h-9 w-9 shrink-0 place-items-center rounded-lg'>
          <Play size={14} />
        </span>
        <span className='min-w-0 flex-1'>
          <span className='block truncate font-medium'>{embed.label}</span>
          <span className='text-muted-foreground block truncate text-[11px]'>
            Opens in a new tab
          </span>
        </span>
        <ExternalLink size={13} className='text-muted-foreground shrink-0' />
      </a>
    );
  }

  if (embed.kind === 'video') {
    return (
      <video
        src={embed.src}
        controls
        preload='metadata'
        playsInline
        className={`aspect-video w-full rounded-xl bg-black ${className}`}
      />
    );
  }

  // Click-to-load. The poster state is a real button so it is keyboard
  // reachable and announces itself.
  return (
    <div
      className={`relative aspect-video w-full overflow-hidden rounded-xl bg-black ${className}`}
    >
      {playing ? (
        <iframe
          src={embed.src}
          title={embed.title}
          allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture'
          allowFullScreen
          className='h-full w-full border-0'
        />
      ) : (
        <button
          type='button'
          onClick={() => setPlaying(true)}
          aria-label='Play showreel'
          className='group bg-gradient-brand/20 grid h-full w-full place-items-center transition hover:bg-black/40'
        >
          <span className='bg-gradient-brand glow text-on-brand grid h-14 w-14 place-items-center rounded-full transition group-hover:scale-105'>
            <Play size={20} className='ml-0.5' fill='currentColor' />
          </span>
        </button>
      )}
    </div>
  );
}
