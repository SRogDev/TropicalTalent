'use client';

import Image from 'next/image';
import { avatarUrl, cn } from '@/lib/utils';

/**
 * A talent's avatar, or their initials when they have no picture.
 *
 * Roughly a third of live profiles have a null avatar, so the initials path is
 * the common case rather than an edge case and gets the same visual weight — a
 * gradient tile that reads as deliberate, not as a broken image.
 */
export function TalentAvatar({
  candidate,
  size = 48,
  className,
  ring,
}: {
  candidate: { avatar: string | null; name?: string | null; username?: string | null } | null;
  size?: number;
  className?: string;
  ring?: boolean;
}) {
  const label = candidate?.name || candidate?.username || '';
  const initials = toInitials(label);
  const src = avatarUrl(candidate?.avatar);

  return (
    <span
      className={cn(
        'relative grid shrink-0 place-items-center overflow-hidden rounded-full',
        ring && 'ring-foreground/15 ring-2',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {src ? (
        <Image
          src={src}
          alt={label}
          width={size}
          height={size}
          className='h-full w-full object-cover'
          sizes={`${size}px`}
          // Avatar URLs carry a cache-busting ?t= query and blob: previews
          // during upload; neither survives the optimiser.
          unoptimized={src.startsWith('blob:') || src.includes('?t=')}
        />
      ) : (
        <span
          className='bg-gradient-brand text-on-brand grid h-full w-full place-items-center font-semibold'
          style={{ fontSize: Math.max(10, size * 0.34) }}
        >
          {initials || '?'}
        </span>
      )}
    </span>
  );
}

function toInitials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
