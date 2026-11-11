'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createTenantAction } from '@/modules/tenancy/actions';
import { ARCHETYPE_PRESETS } from '@/modules/tenancy/presets';
import type { TenantArchetype } from '@/modules/tenancy/types';
import { useToast } from '@/components/ui/toast';

/**
 * The new-tenant form.
 *
 * The shape of a white-label is picked first, because it decides what the rest
 * of the form means: an archetype seeds the feature flags and the capabilities
 * new members get, so choosing "contractors + companies" is what makes
 * contractors earn-only and hides the brief feed. Everything after it is
 * branding and money.
 *
 * Validation is duplicated in modules/tenancy/actions.ts and that is the copy
 * that counts — this one exists to tell someone what is wrong before a round
 * trip, not to be the control.
 */

const SUBDOMAIN_ROOT = 'tropicaltalent.dev';

export function TenantForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [archetype, setArchetype] = useState<TenantArchetype>('contractors_brands');
  const [slug, setSlug] = useState('');
  const [host, setHost] = useState('');
  // Once someone edits the host it stops tracking the slug, or their edit gets
  // overwritten by the next keystroke in the name field.
  const [hostTouched, setHostTouched] = useState(false);

  const preset = ARCHETYPE_PRESETS[archetype];
  const effectiveHost = hostTouched ? host : slug ? `${slug}.${SUBDOMAIN_ROOT}` : '';

  function onSubmit(form: FormData) {
    setError(null);
    form.set('host', effectiveHost);
    form.set('archetype', archetype);

    startTransition(async () => {
      const result = await createTenantAction(form);
      if (result.success !== true) {
        setError(result.error);
        return;
      }
      toast({ title: 'Tenant created', description: `${effectiveHost} is live.` });
      router.push('/admin/tenants');
      router.refresh();
    });
  }

  return (
    <form action={onSubmit} className='max-w-2xl space-y-8'>
      <Section title='Shape' hint='Seeds the feature flags and what new members may do.'>
        <div className='grid gap-2 sm:grid-cols-2'>
          {(Object.keys(ARCHETYPE_PRESETS) as TenantArchetype[])
            // Classic is TropicalTalent itself; there is exactly one and it exists.
            .filter((key) => key !== 'classic')
            .map((key) => {
              const p = ARCHETYPE_PRESETS[key];
              const selected = archetype === key;
              return (
                <button
                  type='button'
                  key={key}
                  onClick={() => setArchetype(key)}
                  className={`rounded-xl border p-4 text-left transition ${
                    selected
                      ? 'border-primary bg-foreground/[0.03]'
                      : 'border-foreground/10 hover:border-foreground/20'
                  }`}
                >
                  <div className='text-sm font-medium'>{p.label}</div>
                  <div className='text-muted-foreground mt-1 text-xs'>{p.description}</div>
                </button>
              );
            })}
        </div>

        <div className='text-muted-foreground mt-3 text-xs'>
          Sign-up will offer <strong>{preset.signup.worker.label}</strong> (
          {capabilityWords(preset.signup.worker.capabilities)}) and{' '}
          <strong>{preset.signup.payer.label}</strong> (
          {capabilityWords(preset.signup.payer.capabilities)}).
        </div>
      </Section>

      <Section title='Identity'>
        <Field label='Name' hint='Shown in the sidebar, emails and page titles.'>
          <input
            name='name'
            required
            maxLength={120}
            className={inputClass}
            placeholder='Acme Talent'
          />
        </Field>

        <Field label='Slug' hint='Lowercase letters, numbers and hyphens.'>
          <input
            name='slug'
            required
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            className={inputClass}
            placeholder='acme'
          />
        </Field>

        <Field
          label='Host'
          hint='A subdomain works immediately. A custom domain needs a CNAME first.'
        >
          <input
            name='host'
            required
            value={effectiveHost}
            onChange={(e) => {
              setHostTouched(true);
              setHost(e.target.value.toLowerCase().trim());
            }}
            className={inputClass}
            placeholder={`acme.${SUBDOMAIN_ROOT}`}
          />
        </Field>
      </Section>

      <Section title='Branding' hint='Anything left blank keeps the TropicalTalent default.'>
        <Field label='Logo URL' hint='https:// only, and it must be served from Supabase Storage.'>
          <input name='logoUrl' className={inputClass} placeholder='https://…/logo.svg' />
        </Field>
        <Field label='Wordmark' hint='Defaults to the name.'>
          <input name='wordmark' maxLength={40} className={inputClass} placeholder='ACME' />
        </Field>
        <Field
          label='From address'
          hint='Needs its domain verified with Resend, or mail sends as “Name via TropicalTalent”.'
        >
          <input
            name='fromEmail'
            type='email'
            className={inputClass}
            placeholder='hello@acme.com'
          />
        </Field>

        <div className='grid gap-3 sm:grid-cols-2'>
          <Field label='Primary'>
            <input name='primary' className={inputClass} placeholder='oklch(0.62 0.19 145)' />
          </Field>
          <Field label='Accent'>
            <input name='accent' className={inputClass} placeholder='oklch(0.7 0.15 90)' />
          </Field>
          <Field label='Gradient from'>
            <input name='gradientFrom' className={inputClass} placeholder='#1f7a4d' />
          </Field>
          <Field label='Gradient to'>
            <input name='gradientTo' className={inputClass} placeholder='#c9a227' />
          </Field>
          <Field
            label='Text on gradient'
            hint='Optional. Defaults to near-white - set it dark for a pale gradient.'
          >
            <input name='gradientForeground' className={inputClass} placeholder='#0b0b0b' />
          </Field>
        </div>
        <p className='text-muted-foreground text-xs'>
          Hex or oklch(). Both gradient stops are needed, or neither is used.
        </p>
      </Section>

      <Section title='People'>
        {/* Decided once, at creation. It sets where this customer's accounts
            live, and changing it later does not retroactively add or remove
            anyone's membership — so it is a creation-time question, not a
            setting to flip. */}
        <label className='flex items-start gap-3'>
          <input name='publicRoster' type='checkbox' className='accent-primary mt-0.5' />
          <span className='space-y-0.5'>
            <span className='block text-sm font-medium'>Their people are also on TropicalTalent</span>
            <span className='text-muted-foreground block text-xs'>
              Off by default. Left off, this workspace is private: its people exist only here and
              cannot sign in to classic TropicalTalent - joining TropicalTalent means opening a TropicalTalent account. Turned
              on, they are TropicalTalent members too and appear on the TropicalTalent Talent board.
            </span>
          </span>
        </label>
      </Section>

      <Section title='Money'>
        <div className='grid gap-3 sm:grid-cols-2'>
          <Field label='Platform fee %' hint='Taken from each project pot.'>
            <input
              name='platformFeePct'
              type='number'
              step='0.01'
              min='0'
              max='99'
              defaultValue='15'
              className={inputClass}
            />
          </Field>
          <Field
            label='Partner share %'
            hint='Share OF the fee owed to this partner, not of the pot.'
          >
            <input
              name='partnerSharePct'
              type='number'
              step='0.01'
              min='0'
              max='100'
              defaultValue='0'
              className={inputClass}
            />
          </Field>
        </div>
      </Section>

      {error && <p className='text-destructive text-sm'>{error}</p>}

      <div className='flex items-center gap-3'>
        <button
          type='submit'
          disabled={pending}
          className='gradient-app text-on-brand rounded-lg px-5 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-60'
        >
          {pending ? 'Creating…' : 'Create tenant'}
        </button>
        <span className='text-muted-foreground text-xs'>
          Powered by TropicalTalent is on by default and only a TropicalTalent admin can remove it.
        </span>
      </div>
    </form>
  );
}

function capabilityWords(c: { brand: boolean; work: boolean }): string {
  if (c.brand && c.work) return 'hires and works';
  if (c.brand) return 'hires only';
  if (c.work) return 'earns only';
  return 'no capabilities';
}

const inputClass =
  'bg-sunken border-foreground/10 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-foreground/25';

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className='space-y-3'>
      <div>
        <h2 className='text-sm font-semibold'>{title}</h2>
        {hint && <p className='text-muted-foreground text-xs'>{hint}</p>}
      </div>
      {children}
    </section>
  );
}

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
