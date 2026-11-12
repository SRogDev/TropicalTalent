'use client';

import { Globe } from 'lucide-react';
import { useLocale } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { LOCALES, type Locale } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * Language switcher (Phase 1, new).
 *
 * Switches locale by navigating to the same path under the other locale —
 * the URL is the locale, so a shared link keeps its language. There was no
 * locale switcher in the tree; this is one of the two genuinely new
 * components in this phase (the other is MadeInCubaBadge).
 */
export function LocaleSwitcher({ className }: { className?: string }) {
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();

  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-lg p-1', className)}
      role='group'
      aria-label='Language / Idioma'
    >
      <Globe size={15} className='text-muted-foreground mr-1' aria-hidden='true' />
      {LOCALES.map((code) => {
        const active = code === locale;
        return (
          <button
            key={code}
            type='button'
            onClick={() => router.replace(pathname, { locale: code })}
            aria-pressed={active}
            aria-label={code === 'es' ? 'Español' : 'English'}
            lang={code}
            className={cn(
              'cursor-pointer rounded-md px-2 py-1 text-xs font-medium transition duration-200',
              active
                ? 'bg-foreground/10 text-foreground'
                : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground',
            )}
          >
            {code.toUpperCase()}
          </button>
        );
      })}
    </span>
  );
}
