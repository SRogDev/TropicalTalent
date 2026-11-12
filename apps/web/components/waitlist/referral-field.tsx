'use client';

import { useEffect, useState } from 'react';
import { Check, Gift } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Where a code from a share link is parked between landing and sign-up. */
const REF_STORAGE_KEY = 'tropical:ref';

/**
 * Reads a referral code from `?ref=` and remembers it.
 *
 * Called on the landing page, which is `force-static` — so this runs on the
 * client, after hydration, and stashes the code. Without the stash the code
 * would be lost the moment the visitor navigated to sign-in, or bounced out
 * to Google and back for OAuth.
 *
 * sessionStorage, not localStorage: a referral belongs to this visit. Someone
 * who followed a friend's link months ago and comes back on their own should
 * not still be silently attributed.
 */
export function captureReferralFromUrl(): string {
  if (typeof window === 'undefined') return '';
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('ref')?.trim();
    if (fromUrl) {
      sessionStorage.setItem(REF_STORAGE_KEY, fromUrl);
      return fromUrl;
    }
    return sessionStorage.getItem(REF_STORAGE_KEY) ?? '';
  } catch {
    // Storage disabled. The field still works, it just will not pre-fill.
    return new URLSearchParams(window.location.search).get('ref')?.trim() ?? '';
  }
}

export function clearStoredReferral(): void {
  try {
    sessionStorage.removeItem(REF_STORAGE_KEY);
  } catch {
    // nothing to do
  }
}

/**
 * The referral code step of sign-up.
 *
 * Optional by design and never validated in the browser: codes are resolved
 * server-side at the moment the account is created, and a typo must not be
 * able to block someone from signing up. If it does not resolve, the account
 * is still created and the referral simply is not credited.
 */
export function ReferralField({
  value,
  onChange,
  prefilled,
  platformName = 'Cubora',
}: {
  value: string;
  onChange: (v: string) => void;
  /** True when it arrived from a share link rather than being typed. */
  prefilled: boolean;
  /**
   * The site this sign-up is for.
   *
   * Was the literal string "TropicalTalent", which every white-label inherited — so a
   * contractor joining a customer's own branded workspace was asked whether
   * someone had invited them to a company they had never heard of, on the
   * customer's own domain. Defaulted rather than required so the classic
   * landing page, which passes no tenant, is unchanged.
   */
  platformName?: string;
}) {
  return (
    <div className='space-y-4 text-center'>
      <h2 className='text-foreground text-lg font-semibold md:text-xl'>
        {prefilled ? 'You were invited' : 'Got a referral code?'}
      </h2>
      <p className='text-muted-foreground text-xs'>
        {prefilled
          ? "We've filled it in for you - the person who invited you gets credit."
          : `Optional. Paste it here if someone invited you to ${platformName}.`}
      </p>

      <div className='mx-auto max-w-sm space-y-1 text-left'>
        <Label htmlFor='signup-referral'>Referral code</Label>
        <div className='relative'>
          <Gift className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
          <Input
            id='signup-referral'
            value={value}
            autoFocus={!prefilled}
            autoCapitalize='characters'
            autoComplete='off'
            spellCheck={false}
            // Codes are stored and compared uppercase; typing lowercase is
            // fine, but showing it back uppercase makes a mismatch obvious.
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            placeholder='e.g. VIVIDSTYLE735'
            className='pr-9 pl-9 font-mono tracking-wider'
          />
          {prefilled && value && (
            <Check className='text-status-active absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2' />
          )}
        </div>
        <p className='text-muted-foreground pt-1 text-xs'>Skip this if you don&apos;t have one.</p>
      </div>
    </div>
  );
}

/** Reads the stored/URL code once on mount. */
export function useReferralCode(): [string, (v: string) => void, boolean] {
  const [code, setCode] = useState('');
  const [prefilled, setPrefilled] = useState(false);

  useEffect(() => {
    const found = captureReferralFromUrl();
    if (found) {
      setCode(found.toUpperCase());
      setPrefilled(true);
    }
  }, []);

  return [code, setCode, prefilled];
}
