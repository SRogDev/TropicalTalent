import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

/**
 * The Made in Cuba seal badge.
 *
 * The only place the seal artwork is rendered. There was no badge/chip
 * component in the tree to reuse (the only "badge" usages are inline unread
 * counts and a lucide BadgeCheck), so this small component is genuinely new.
 *
 * The seal marks ORIGIN, not quality: it must only ever be shown on an
 * offer whose Cuban origin has been verified, and verification logic is
 * Phase 2. On the landing page it appears as brand identity — what the seal
 * means — never attached to a specific product.
 */
export function MadeInCubaBadge({
  size = 96,
  className,
  showLabel = true,
}: {
  size?: number;
  className?: string;
  showLabel?: boolean;
}) {
  const t = useTranslations('seal');
  return (
    <span className={cn('inline-flex flex-col items-center gap-2', className)}>
      <Image
        src='/made-in-cuba-seal.svg'
        alt={t('label')}
        width={size}
        height={size}
        className='h-auto shrink-0'
        style={{ width: size }}
      />
      {showLabel && (
        <span className='text-xs font-semibold tracking-[0.18em] uppercase'>{t('label')}</span>
      )}
    </span>
  );
}
