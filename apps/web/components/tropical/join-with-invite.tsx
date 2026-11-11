'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { joinTenantWithInviteAction } from '@/modules/identity/actions';

/**
 * The "you were invited, come in" button on /auth/no-access.
 *
 * A client component rather than a bare form post like the sign-out control
 * beside it, for one reason: this action can fail in a way the person needs to
 * read. An invite claimed from another tab, or a membership an admin revoked
 * between the page rendering and the click, has to say so — a form post would
 * silently re-render the same dead end.
 *
 * It takes no props about the invite. The action re-derives the tenant from
 * the host and the address from the session, so there is nothing here worth
 * forging and nothing to keep in sync with the server.
 */
export function JoinWithInvite({ tenantName }: { tenantName: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function join() {
    setError(null);
    startTransition(async () => {
      const result = await joinTenantWithInviteAction();
      if (result.success !== true) {
        setError(result.error);
        return;
      }
      // replace(), not push(): the account is a member now, so no-access is no
      // longer a page they should be able to reach with the back button.
      router.replace(result.data.next);
      router.refresh();
    });
  }

  return (
    <div className='w-full space-y-2'>
      <button
        type='button'
        onClick={join}
        disabled={pending}
        className='gradient-app text-on-brand h-11 w-full rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50'
      >
        {pending ? 'Joining…' : `Join ${tenantName}`}
      </button>
      {error && <p className='text-destructive text-sm'>{error}</p>}
    </div>
  );
}
