'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useToast } from '@/components/ui/toast';
import { deleteTenantAction, updateTenantAction } from '@/modules/tenancy/actions';

/**
 * The safe half of tenant configuration, plus the one dangerous button.
 *
 * Only cosmetic and behavioural fields are editable here. Slug, host,
 * archetype and fees are identity and commercials — changing those under a
 * live customer breaks links or reprices them, and neither belongs behind a
 * colour picker. The action enforces that too; this form just does not offer
 * them.
 */
export function TenantSettings({
  tenantId,
  initial,
  canDelete,
}: {
  tenantId: string;
  /**
   * Whether deletion is offered at all.
   *
   * False on a white-label's own host. Editing a customer's branding from their
   * site is the point of signing in there; deleting the workspace you are
   * standing in is an estate operation, deleteTenantAction() refuses it from
   * anywhere but the TropicalTalent console, and a button that always errors is worse
   * than no button.
   */
  canDelete: boolean;
  initial: {
    name: string;
    wordmark?: string;
    logoUrl?: string;
    fromEmail?: string;
    primary?: string;
    accent?: string;
    gradient?: string[];
    /** Label colour on the brand gradient. Near-white when unset. */
    gradientForeground?: string;
    poweredBy?: boolean;
    inviteOnly?: boolean;
    projectCount: number;
  };
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  function save(form: FormData) {
    setError(null);
    form.set('tenantId', tenantId);
    startTransition(async () => {
      const result = await updateTenantAction(form);
      if (result.success !== true) {
        setError(result.error);
        return;
      }
      toast({ title: 'Saved', description: 'Live on the next page load.' });
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteTenantAction(tenantId);
      if (result.success !== true) {
        setConfirming(false);
        toast({ title: 'Not deleted', description: result.error, variant: 'destructive' });
        return;
      }
      toast({ title: 'Tenant deleted' });
      router.push('/admin/tenants');
      router.refresh();
    });
  }

  return (
    <div className='space-y-8'>
      <form action={save} className='space-y-4'>
        <Field label='Name'>
          <input name='name' defaultValue={initial.name} required className={input} />
        </Field>

        <div className='grid gap-3 sm:grid-cols-2'>
          <Field label='Wordmark' hint='Defaults to the name.'>
            <input name='wordmark' defaultValue={initial.wordmark ?? ''} className={input} />
          </Field>
          <Field label='From address' hint='Needs its domain verified with Resend first.'>
            <input
              name='fromEmail'
              type='email'
              defaultValue={initial.fromEmail ?? ''}
              className={input}
            />
          </Field>
        </div>

        <Field
          label='Logo URL'
          hint='Must be a public https:// Supabase Storage URL - a signed URL expires.'
        >
          <input name='logoUrl' defaultValue={initial.logoUrl ?? ''} className={input} />
        </Field>

        <div className='grid gap-3 sm:grid-cols-2'>
          <Field label='Primary'>
            <input name='primary' defaultValue={initial.primary ?? ''} className={input} />
          </Field>
          <Field label='Accent'>
            <input name='accent' defaultValue={initial.accent ?? ''} className={input} />
          </Field>
          <Field label='Gradient from'>
            <input
              name='gradientFrom'
              defaultValue={initial.gradient?.[0] ?? ''}
              className={input}
            />
          </Field>
          <Field label='Gradient to'>
            <input name='gradientTo' defaultValue={initial.gradient?.[1] ?? ''} className={input} />
          </Field>
          {/* The label colour ON the gradient buttons. Unset it is near-white,
              which disappears on a pale gradient — and every gradient button in
              the product uses it, including the sign-in one. */}
          <Field label='Text on gradient'>
            <input
              name='gradientForeground'
              defaultValue={initial.gradientForeground ?? ''}
              className={input}
            />
          </Field>
        </div>
        <p className='text-muted-foreground text-xs'>
          Hex or oklch(). Both gradient stops or neither - a single stop is ignored.
        </p>

        <div className='space-y-2 pt-2'>
          <label className='flex items-center gap-2 text-xs'>
            <input
              type='checkbox'
              name='inviteOnly'
              defaultChecked={initial.inviteOnly}
              className='accent-primary'
            />
            <span>
              Invite only -{' '}
              <span className='text-muted-foreground'>only pre-authorised emails may sign up</span>
            </span>
          </label>
          <label className='flex items-center gap-2 text-xs'>
            <input
              type='checkbox'
              name='poweredBy'
              defaultChecked={initial.poweredBy !== false}
              className='accent-primary'
            />
            <span>
              Show &ldquo;Powered by TropicalTalent&rdquo; -{' '}
              <span className='text-muted-foreground'>only you can change this</span>
            </span>
          </label>
        </div>

        {error && <p className='text-destructive text-sm'>{error}</p>}

        <button
          type='submit'
          disabled={pending}
          className='gradient-app text-on-brand rounded-lg px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-60'
        >
          {pending ? 'Saving…' : 'Save changes'}
        </button>
      </form>

      {canDelete && (
        <section className='border-destructive/30 space-y-2 rounded-xl border p-4'>
          <h3 className='text-destructive text-sm font-semibold'>Delete this tenant</h3>
          <p className='text-muted-foreground text-xs'>
            Removes the tenant, its hosts, its members and its roster. It does not delete
            anyone&apos;s account.{' '}
            {initial.projectCount > 0 && (
              <span className='text-status-pending'>
                This tenant has {initial.projectCount} project
                {initial.projectCount === 1 ? '' : 's'}, so deletion is refused - suspend it
                instead.
              </span>
            )}
          </p>

          {confirming ? (
            <div className='flex flex-wrap items-center gap-2'>
              <span className='text-xs'>Certain?</span>
              <button
                type='button'
                onClick={remove}
                disabled={pending}
                className='bg-destructive text-on-brand rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-60'
              >
                {pending ? 'Deleting…' : 'Yes, delete'}
              </button>
              <button
                type='button'
                onClick={() => setConfirming(false)}
                className='border-foreground/10 rounded-lg border px-3 py-1.5 text-xs'
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type='button'
              onClick={() => setConfirming(true)}
              className='border-destructive/40 text-destructive hover:bg-destructive/5 rounded-lg border px-3 py-1.5 text-xs transition'
            >
              Delete tenant
            </button>
          )}
        </section>
      )}
    </div>
  );
}

const input =
  'bg-sunken border-foreground/10 focus:border-foreground/25 w-full rounded-lg border px-3 py-2 text-sm outline-none';

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className='block space-y-1'>
      <span className='text-xs font-medium'>{label}</span>
      {children}
      {hint && <span className='text-muted-foreground block text-xs'>{hint}</span>}
    </label>
  );
}
