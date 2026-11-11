'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SignUpTenant } from './sign-up-dialog';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { completeProfileAction } from '@/modules/identity/actions';
import { TERMS_URL } from '@/lib/legal';
import {
  bioStepSchema,
  brandBlurbStepSchema,
  nameStepSchema,
  passionStepSchema,
} from '@/modules/identity/schema';
import {
  BioStep,
  BrandBlurbStep,
  LocationStep,
  NameStep,
  PassionStep,
  PhotoStep,
  RoleStep,
} from './steps';
import { ReferralField, clearStoredReferral, useReferralCode } from './referral-field';
import { ALL_REFERRALS, hasReferralStep } from './use-sign-up-form';
import type { SignUpRole } from './use-sign-up-form';

/**
 * Profile completion for a user who signed in with Google.
 *
 * The same steps as the sign-up dialog, minus name-as-step-one (Google already
 * gave us one, shown pre-filled and editable) and minus the credentials step
 * entirely. Rendered as a page rather than a dialog because there is nothing
 * behind it to dismiss back to — the account exists, it is just incomplete.
 */
export function CompleteProfile({
  defaultName,
  hasAvatar,
  tenant = { name: 'TropicalTalent', allowPayer: true },
}: {
  defaultName: string;
  hasAvatar: boolean;
  /** Same shape and the same reason as the sign-up dialog's — see SignUpTenant. */
  tenant?: SignUpTenant;
}) {
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [name, setName] = useState(defaultName);
  const [role, setRole] = useState<SignUpRole | null>(null);
  const [companyBlurb, setCompanyBlurb] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [passions, setPassions] = useState<string[]>([]);
  const [bio, setBio] = useState('');
  const [locationText, setLocationText] = useState('');

  const [submitting, setSubmitting] = useState(false);
  // The sign-up dialog gates its Google button on a tick-box, but a person who
  // lands here directly — an OAuth account created before this form existed,
  // or anyone who abandoned it and came back — never passed that gate. This is
  // the same consent, asked at the only other place an account is completed.
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [error, setError] = useState('');

  // A ?ref= code stashed on the landing page survives the round trip out to
  // Google and back, because it lives in sessionStorage on the same origin.
  const [linkCode, setLinkCode, linkPrefilled] = useReferralCode();

  // Step 0 name, 1 role, then the branch. Google users who already have an
  // avatar skip the photo step — re-asking for a picture they just supplied
  // reads as the app not having noticed.
  //
  // The referral step follows the same audience rule as the password sign-up
  // dialog. It did not until 2026-08-27: this list appended 'referral'
  // unconditionally, so the OAuth path offered a code on workspaces where the
  // dialog had already dropped it.
  const referrals = tenant.referrals ?? ALL_REFERRALS;
  const steps = useMemo(() => {
    const base = ['name', 'role'] as const;
    const referral = hasReferralStep(role, referrals) ? (['referral'] as const) : [];
    if (role === 'brand') return [...base, 'blurb', ...referral];
    if (role === 'creative') {
      return hasAvatar
        ? [...base, 'passion', 'bio', 'location', ...referral]
        : [...base, 'photo', 'passion', 'bio', 'location', ...referral];
    }
    return [...base];
  }, [role, hasAvatar, referrals]);

  const current = steps[step];
  const isLast = step === steps.length - 1;

  const canProceed = (): boolean => {
    switch (current) {
      case 'name':
        return nameStepSchema.safeParse({ name }).success;
      case 'role':
        return role !== null;
      case 'blurb':
        return brandBlurbStepSchema.safeParse({ companyBlurb }).success;
      case 'photo':
        return true;
      case 'passion':
        return passionStepSchema.safeParse({ passions }).success;
      case 'bio':
        return bioStepSchema.safeParse({ bio }).success;
      case 'location':
        return locationText.trim() !== '';
      // Optional, so it never blocks.
      case 'referral':
        return true;
      default:
        return false;
    }
  };

  const submit = useCallback(async () => {
    setSubmitting(true);
    setError('');

    const form = new FormData();
    form.set('name', name);
    form.set('role', role ?? '');

    if (role === 'brand') {
      form.set('companyBlurb', companyBlurb);
    } else {
      form.set('passions', JSON.stringify(passions));
      form.set('bio', bio);
      if (locationText.trim()) form.set('locationText', locationText.trim());
      if (photoFile) form.set('photo', photoFile);
    }

    if (linkCode.trim()) form.set('referralCode', linkCode.trim());

    const result = await completeProfileAction(form);

    if (result.success !== true) {
      setSubmitting(false);
      setError(result.error);
      return;
    }

    clearStoredReferral();
    router.refresh();
    router.push(result.data.next);
  }, [name, role, companyBlurb, passions, bio, locationText, photoFile, linkCode, router]);

  const renderStep = () => {
    switch (current) {
      case 'name':
        return <NameStep value={name} onChange={setName} />;
      case 'role':
        return (
          <RoleStep
            value={role}
            onChange={setRole}
            tenantName={tenant.name}
            workerLabel={tenant.workerLabel}
            payerLabel={tenant.payerLabel}
            workerPlural={tenant.workerPlural}
            allowPayer={tenant.allowPayer !== false}
          />
        );
      case 'blurb':
        return <BrandBlurbStep value={companyBlurb} onChange={setCompanyBlurb} />;
      case 'photo':
        return (
          <PhotoStep
            preview={photoPreview}
            onChange={(file, preview) => {
              setPhotoFile(file);
              setPhotoPreview(preview);
            }}
          />
        );
      case 'passion':
        return <PassionStep value={passions} onChange={setPassions} />;
      case 'bio':
        return <BioStep value={bio} onChange={setBio} />;
      case 'location':
        return <LocationStep value={locationText} onChange={setLocationText} />;
      case 'referral':
        return <ReferralField value={linkCode} onChange={setLinkCode} prefilled={linkPrefilled} />;
      default:
        return null;
    }
  };

  return (
    <div className='w-full max-w-md space-y-4'>
      <Progress value={((step + 1) / steps.length) * 100} />

      <div key={current} className='step-enter'>
        {renderStep()}
      </div>

      {error && <p className='text-destructive text-center text-sm'>{error}</p>}

      {isLast && (
        <label className='text-muted-foreground flex items-start gap-2 text-xs'>
          <input
            type='checkbox'
            checked={agreedToTerms}
            onChange={(e) => setAgreedToTerms(e.target.checked)}
            className='accent-primary mt-0.5 h-3.5 w-3.5 shrink-0'
          />
          <span>
            I agree to the{' '}
            <a
              href={TERMS_URL}
              target='_blank'
              rel='noopener noreferrer'
              className='text-foreground underline underline-offset-2'
            >
              Terms and Conditions
            </a>
          </span>
        </label>
      )}

      <div className='flex justify-between gap-2 pt-2'>
        <Button
          type='button'
          variant='ghost'
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0 || submitting}
          className='gap-1'
        >
          <ChevronLeft className='h-4 w-4' />
          Back
        </Button>
        <Button
          type='button'
          onClick={() => (isLast ? void submit() : setStep((s) => s + 1))}
          disabled={!canProceed() || submitting || (isLast && !agreedToTerms)}
          className='gradient-app text-on-brand flex-1 hover:opacity-90 sm:flex-none sm:px-8'
        >
          {submitting ? (
            <span className='flex items-center gap-2'>
              <Loader2 className='h-4 w-4 animate-spin' />
              Finishing…
            </span>
          ) : isLast ? (
            'Finish'
          ) : (
            'Continue'
          )}
        </Button>
      </div>
    </div>
  );
}
