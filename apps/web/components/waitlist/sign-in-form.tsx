'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { resendConfirmationAction, signInAction } from '@/modules/identity/actions';

export function SignInForm({ next }: { next: string }) {
  const t = useTranslations('auth');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  // Matches the sentence translateAuthError() produces for an unconfirmed
  // address, which is the only case a resend can help with.
  const needsConfirmation = error.toLowerCase().includes('confirm your email');

  const resend = () => {
    setResending(true);
    startTransition(async () => {
      const form = new FormData();
      form.set('email', email);
      const result = await resendConfirmationAction(form);
      setResending(false);
      // The action answers identically for a registered and an unregistered
      // address, so there is nothing to branch on but a rate limit.
      if (result.success !== true) {
        setError(result.error);
        return;
      }
      setResent(true);
    });
  };

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    form.set('next', next);
    setError('');
    setResent(false);

    startTransition(async () => {
      const result = await signInAction(form);
      if (result.success !== true) {
        setError(result.error);
        return;
      }
      // ONE navigation, not a refresh racing a push.
      //
      // This used to call router.refresh() and then router.push() back to back
      // inside the same transition. Both kick off an RSC request: refresh()
      // re-renders THIS route on the server while push() navigates away from
      // it. When the refresh resolved second the transition never settled, so
      // isPending stayed true and the button sat on "Logging in…" forever —
      // the reported freeze. Reloading by hand appeared to fix it only because
      // the session cookie had been written all along.
      //
      // replace() alone is enough: the server components under (app) are
      // rendered fresh for this navigation and read the new cookie. replace
      // rather than push so Back does not return to a sign-in form the user
      // has already completed.
      router.replace(result.data.next);
    });
  };

  return (
    <form onSubmit={onSubmit} className='mt-4 space-y-4'>
      <div className='space-y-1'>
        <Label htmlFor='email'>{t('email')}</Label>
        <Input
          id='email'
          name='email'
          type='email'
          autoComplete='email'
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div className='space-y-1'>
        <div className='flex items-center justify-between'>
          <Label htmlFor='password'>{t('password')}</Label>
          <Link
            href='/auth/reset'
            className='text-muted-foreground text-xs underline underline-offset-2'
          >
            {t('forgotPassword')}
          </Link>
        </div>
        <Input
          id='password'
          name='password'
          type='password'
          autoComplete='current-password'
          required
        />
      </div>

      {error && <p className='text-destructive text-sm'>{error}</p>}

      {/* Offered exactly when it is the answer.
       *
       * translateAuthError turns Supabase's "email not confirmed" into this
       * sentence, and until now that sentence was the end of the road: the
       * link had expired or never arrived, and signing up again is refused
       * because the address is taken. */}
      {needsConfirmation && (
        <div className='border-foreground/10 bg-sunken rounded-lg border p-3 text-sm'>
          {resent ? (
            <p className='text-muted-foreground'>
              If that address needs confirming, a new link is on its way. It expires in 24 hours.
            </p>
          ) : (
            <button
              type='button'
              onClick={resend}
              disabled={resending}
              className='text-foreground underline underline-offset-4 disabled:opacity-60'
            >
              {resending ? 'Sending…' : 'Resend confirmation email'}
            </button>
          )}
        </div>
      )}

      <Button
        type='submit'
        disabled={pending}
        className='gradient-app text-on-brand h-11 w-full hover:opacity-90'
      >
        {pending ? (
          <span className='flex items-center gap-2'>
            <Loader2 className='h-4 w-4 animate-spin' /> {t('signingIn')}
          </span>
        ) : (
          t('signIn')
        )}
      </Button>
    </form>
  );
}
