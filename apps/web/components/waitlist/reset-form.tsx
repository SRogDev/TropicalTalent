'use client';

import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { requestPasswordResetAction, updatePasswordAction } from '@/modules/identity/actions';

export function ResetForm() {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<{ error?: string; sent?: boolean }>({});

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await requestPasswordResetAction(form);
          setState(result.success === true ? { sent: true } : { error: result.error });
        });
      }}
      className='mt-8 space-y-4'
    >
      {state.sent ? (
        <p className='text-center text-sm'>Check your inbox - the link is valid for one hour.</p>
      ) : (
        <>
          <div className='space-y-1'>
            <Label htmlFor='email'>Email</Label>
            <Input id='email' name='email' type='email' autoComplete='email' required autoFocus />
          </div>
          {state.error && <p className='text-destructive text-sm'>{state.error}</p>}
          <Button
            type='submit'
            disabled={pending}
            className='gradient-app text-on-brand h-11 w-full hover:opacity-90'
          >
            {pending ? <Loader2 className='h-4 w-4 animate-spin' /> : 'Send reset link'}
          </Button>
        </>
      )}
    </form>
  );
}

export function UpdatePasswordForm() {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<{ error?: string; done?: boolean }>({});

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await updatePasswordAction(form);
          setState(result.success === true ? { done: true } : { error: result.error });
        });
      }}
      className='mt-8 space-y-4'
    >
      {state.done ? (
        <p className='text-center text-sm'>Password updated. You can log in with it now.</p>
      ) : (
        <>
          <div className='space-y-1'>
            <Label htmlFor='password'>New password</Label>
            <Input
              id='password'
              name='password'
              type='password'
              autoComplete='new-password'
              required
              autoFocus
              placeholder='At least 8 characters'
            />
          </div>
          {state.error && <p className='text-destructive text-sm'>{state.error}</p>}
          <Button
            type='submit'
            disabled={pending}
            className='gradient-app text-on-brand h-11 w-full hover:opacity-90'
          >
            {pending ? <Loader2 className='h-4 w-4 animate-spin' /> : 'Update password'}
          </Button>
        </>
      )}
    </form>
  );
}
