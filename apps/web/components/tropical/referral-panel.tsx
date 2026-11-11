'use client';

import { useState } from 'react';
import { Check, Copy, Gift, Lock, Share2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  nextTier,
  referralLink,
  referralsToNext,
  tiersFor,
  type ReferralAudience,
} from '@/modules/referrals/tiers';

/**
 * The referral scheme, on the user's own profile.
 *
 * Shows their code, a share link built from it, and the reward ladder with
 * what they have unlocked so far.
 *
 * The code is `users.referrer_code` — already unique and already generated for
 * every account by an existing trigger, so there is nothing to mint and no
 * second identifier for anyone to confuse it with.
 *
 * Only rendered on your own profile; a visitor must not be handed someone
 * else's referral code to spend.
 */
export function ReferralPanel({
  code,
  confirmed,
  tier,
  audience,
}: {
  code: string | null;
  confirmed: number;
  tier: number;
  /** Which side of the marketplace they are on — the rewards differ. */
  audience: ReferralAudience;
}) {
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);

  // Migration 014 not applied yet, or a row with no code. Say so rather than
  // rendering an empty box with a copy button that copies nothing.
  if (!code) {
    return (
      <section className='mt-7'>
        <h2 className='text-muted-foreground mb-2.5 text-[11px] tracking-[0.14em] uppercase'>
          Refer a friend
        </h2>
        <p className='text-muted-foreground/70 text-sm'>
          Your referral code isn&apos;t ready yet. Check back shortly.
        </p>
      </section>
    );
  }

  const link = referralLink(
    code,
    typeof window === 'undefined' ? undefined : window.location.origin,
  );
  const ladder = tiersFor(audience);
  const next = nextTier(confirmed, audience);
  const remaining = referralsToNext(confirmed);

  const copy = async (what: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(what === 'code' ? code : link);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard blocked (insecure context, or denied). The value is on
      // screen and selectable, so this is not a dead end.
    }
  };

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'TropicalTalent',
          text: `Join me on TropicalTalent - use my code ${code}`,
          url: link,
        });
        return;
      } catch {
        return; // dismissed
      }
    }
    void copy('link');
  };

  return (
    <section className='mt-7'>
      <h2 className='text-muted-foreground mb-2.5 text-[11px] tracking-[0.14em] uppercase'>
        Refer a friend
      </h2>

      <div className='glass relative overflow-hidden rounded-2xl p-5'>
        <div className='bg-gradient-brand absolute -top-20 -right-20 h-52 w-52 rounded-full opacity-20 blur-3xl' />

        <div className='relative'>
          <div className='text-accent flex items-center gap-1.5 text-[11px] tracking-widest uppercase'>
            <Gift size={12} />
            {confirmed === 0
              ? 'Invite creatives and brands'
              : `${confirmed} successful referral${confirmed === 1 ? '' : 's'}`}
          </div>

          <p className='text-muted-foreground mt-2 text-sm'>
            {next
              ? `${remaining} more ${remaining === 1 ? 'signup' : 'signups'} unlocks ${next.title.toLowerCase()}.`
              : 'You have unlocked every reward. Thank you.'}
          </p>

          {/* --- the code --- */}
          <div className='mt-4 flex flex-col gap-2 sm:flex-row'>
            <div className='border-foreground/10 bg-sunken flex flex-1 items-center gap-2 rounded-xl border px-4 py-3'>
              <code className='min-w-0 flex-1 truncate font-mono text-base tracking-wider'>
                {code}
              </code>
              <button
                type='button'
                onClick={() => void copy('code')}
                aria-label='Copy referral code'
                className='text-muted-foreground hover:text-foreground shrink-0 transition'
              >
                {copied === 'code' ? (
                  <Check size={15} className='text-status-active' />
                ) : (
                  <Copy size={15} />
                )}
              </button>
            </div>

            <button
              type='button'
              onClick={() => void copy('link')}
              className='text-muted-foreground border-foreground/10 hover:text-foreground flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-xs transition'
            >
              {copied === 'link' ? (
                <>
                  <Check size={14} className='text-status-active' /> Link copied
                </>
              ) : (
                <>
                  <Copy size={14} /> Copy link
                </>
              )}
            </button>

            <button
              type='button'
              onClick={() => void share()}
              className='bg-gradient-brand text-on-brand flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-xs font-medium'
            >
              <Share2 size={14} /> Share
            </button>
          </div>

          <p className='text-muted-foreground mt-2 truncate text-[11px]'>{link}</p>

          {/* --- the ladder --- */}
          <ol className='mt-5 space-y-2'>
            {ladder.map((t) => {
              const unlocked = tier >= t.tier;
              return (
                <li
                  key={t.tier}
                  className={cn(
                    'flex gap-3 rounded-xl border px-4 py-3',
                    unlocked
                      ? 'border-status-active/30 bg-status-active/[0.07]'
                      : 'border-foreground/10 bg-sunken',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold',
                      unlocked
                        ? 'bg-status-active/20 text-status-active'
                        : 'text-muted-foreground bg-foreground/5',
                    )}
                  >
                    {unlocked ? <Check size={12} /> : <Lock size={10} />}
                  </span>

                  <div className='min-w-0 flex-1'>
                    <div className='flex flex-wrap items-baseline justify-between gap-2'>
                      <span
                        className={cn('text-sm font-medium', !unlocked && 'text-muted-foreground')}
                      >
                        {t.title}
                      </span>
                      <span className='text-muted-foreground shrink-0 text-[10px] tracking-widest uppercase'>
                        {t.threshold} referral{t.threshold === 1 ? '' : 's'}
                      </span>
                    </div>
                    <p className='text-muted-foreground mt-0.5 text-xs leading-relaxed'>
                      {t.description}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
