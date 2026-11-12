'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  bioStepSchema,
  brandBlurbStepSchema,
  emailStepSchema,
  nameStepSchema,
  passionStepSchema,
} from '@/modules/identity/schema';
import { ALL_REFERRALS, hasReferralStep, useSignUpForm } from './use-sign-up-form';
import type { ReferralAudience } from './use-sign-up-form';
import { GoogleButton, OrDivider } from './google-button';
import { ReferralField, useReferralCode } from './referral-field';
import {
  BioStep,
  BrandBlurbStep,
  CredentialsStep,
  LocationStep,
  NameStep,
  PassionStep,
  PhotoStep,
  RoleStep,
  SuccessStep,
} from './steps';
import { TERMS_URL } from '@/lib/legal';

/**
 * The sign-up wizard.
 *
 * Structurally the waitlist dialog it replaces — same steps, same progress
 * bar, same back/continue footer — but the submit creates a real account.
 *
 * The step validation uses the same zod schemas the server action does, so a
 * step can never pass here and fail on submit.
 */
/**
 * Who this wizard is signing someone up TO.
 *
 * Every field is optional and defaults to TropicalTalent, which is what keeps
 * app/page.tsx `force-static`: the landing page renders the dialog without
 * knowing anything about a tenant, and reading the Host header up there would
 * make the whole marketing route dynamic. /auth/sign-in is already a dynamic
 * server component that calls getTenant(), so that is where the real values
 * come from — and on a white-label it is the ONLY entry point, because the
 * gateway redirects `/` straight to it.
 */
export interface SignUpTenant {
  name: string;
  /** ARCHETYPE_PRESETS[...].signup.worker.label — "Talent", "Contractor". */
  workerLabel?: string;
  /** ARCHETYPE_PRESETS[...].signup.payer.label — "Brand", "Company". */
  payerLabel?: string;
  /** nounsFor(...).worker.many — "talent", "contractors". For card copy. */
  workerPlural?: string;
  /** False when features.selfServeBrands is off: payers are invited, not open. */
  allowPayer?: boolean;
  /**
   * Who is offered the referral step, by side of the marketplace.
   *
   * From referralAudience() in modules/tenancy/presets.ts, which reads two
   * things: whether the tenant runs referrals at all (features.referrals — off
   * for a workspace whose people were put on a roster rather than recruited),
   * and, where it does, whether contractors are excluded. Bring a friend and
   * earn a reward is a talent-marketplace idea; a contractor on a client's
   * branded workspace is not growing anyone's community.
   *
   * Absent means both sides see it, which is classic TropicalTalent.
   */
  referrals?: ReferralAudience;
}

const CLASSIC_TENANT: SignUpTenant = { name: 'Cubora', allowPayer: true };

export function SignUpDialog({
  trigger,
  tenant = CLASSIC_TENANT,
}: {
  trigger: ReactNode;
  tenant?: SignUpTenant;
}) {
  // Read before the wizard is constructed, because it changes how many steps
  // there are.
  const referrals = tenant.referrals ?? ALL_REFERRALS;

  const {
    state,
    update,
    totalSteps,
    goNext,
    goBack,
    submit,
    status,
    errorMessage,
    needsConfirmation,
    reset,
  } = useSignUpForm(referrals);

  const { currentStep, role } = state;

  // Gates both the Google button (which creates the account immediately, on
  // step 0) and the final "Sign up" submit — the one checkbox covers both
  // entry points rather than living inside a step that one path skips.
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  // A code from a ?ref= share link, captured on the landing page.
  const [linkCode, , linkPrefilled] = useReferralCode();

  // Seed the form's code once the link code resolves, without clobbering
  // anything the user has typed themselves.
  useEffect(() => {
    if (linkCode && !state.referralCode) update('referralCode', linkCode);
  }, [linkCode, state.referralCode, update]);

  // With payers invite-only there is one side left, so choose it for them. The
  // step still renders — a person should be able to see what kind of account
  // they are opening — but it stops being a question with one answer.
  useEffect(() => {
    if (tenant.allowPayer === false && role === null) update('role', 'creative');
  }, [tenant.allowPayer, role, update]);

  // Last when there is one at all.
  const isReferralStep = hasReferralStep(role, referrals) && currentStep === totalSteps - 1;

  const canProceed = (): boolean => {
    if (currentStep === 0) return nameStepSchema.safeParse({ name: state.name }).success;
    if (currentStep === 1) {
      return emailStepSchema.safeParse({ email: state.email, password: state.password }).success;
    }
    if (currentStep === 2) return role !== null;

    if (role === 'brand' && currentStep === 3) {
      return brandBlurbStepSchema.safeParse({ companyBlurb: state.companyBlurb }).success;
    }

    if (role === 'creative') {
      if (currentStep === 3) return true; // photo is optional
      if (currentStep === 4)
        return passionStepSchema.safeParse({ passions: state.passions }).success;
      if (currentStep === 5) return bioStepSchema.safeParse({ bio: state.bio }).success;
      if (currentStep === 6) return state.locationText.trim() !== '';
    }

    // The referral code is optional, so this step never blocks.
    if (isReferralStep) return true;

    return false;
  };

  const renderStep = () => {
    if (currentStep === 0) {
      return (
        <div className='space-y-4'>
          {/* Google first: it skips the credentials entirely, and the profile
              questions are then asked at /auth/complete instead. */}
          <GoogleButton mode='register' disabled={!agreedToTerms} />
          <OrDivider label='or sign up with email' />
          <NameStep value={state.name} onChange={(v) => update('name', v)} />
        </div>
      );
    }
    if (currentStep === 1) {
      return (
        <CredentialsStep
          email={state.email}
          password={state.password}
          onEmailChange={(v) => update('email', v)}
          onPasswordChange={(v) => update('password', v)}
        />
      );
    }
    if (currentStep === 2) {
      return (
        <RoleStep
          value={role}
          onChange={(r) => update('role', r)}
          tenantName={tenant.name}
          workerLabel={tenant.workerLabel}
          payerLabel={tenant.payerLabel}
          workerPlural={tenant.workerPlural}
          allowPayer={tenant.allowPayer !== false}
        />
      );
    }

    if (isReferralStep) {
      return (
        <ReferralField
          value={state.referralCode}
          onChange={(v) => update('referralCode', v)}
          prefilled={linkPrefilled}
          platformName={tenant.name}
        />
      );
    }

    if (role === 'brand' && currentStep === 3) {
      return (
        <BrandBlurbStep value={state.companyBlurb} onChange={(v) => update('companyBlurb', v)} />
      );
    }

    if (role === 'creative') {
      if (currentStep === 3) {
        return (
          <PhotoStep
            preview={state.photoPreview}
            onChange={(file, preview) => {
              update('photoFile', file);
              update('photoPreview', preview);
            }}
          />
        );
      }
      if (currentStep === 4) {
        return <PassionStep value={state.passions} onChange={(v) => update('passions', v)} />;
      }
      if (currentStep === 5) {
        return <BioStep value={state.bio} onChange={(v) => update('bio', v)} />;
      }
      if (currentStep === 6) {
        return (
          <LocationStep value={state.locationText} onChange={(v) => update('locationText', v)} />
        );
      }
    }

    return null;
  };

  const progress = ((currentStep + 1) / totalSteps) * 100;
  const isLastStep = currentStep === totalSteps - 1;
  const isSubmitting = status === 'submitting';
  const isSuccess = status === 'success';

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          reset();
          setAgreedToTerms(false);
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className='max-w-md gap-4 p-5 pt-8 sm:p-6 sm:pt-9'>
        <DialogTitle className='sr-only'>Create your {tenant.name} account</DialogTitle>
        <DialogDescription className='sr-only'>
          A short form to create your {tenant.name} account
        </DialogDescription>

        {!isSuccess && <Progress value={progress} className='mr-8' />}

        {/* key on the step so React remounts, which restarts the CSS enter
            animation — the same effect AnimatePresence gave, without the
            animation library. */}
        <div key={isSuccess ? 'success' : currentStep} className='step-enter'>
          {isSuccess ? (
            <SuccessStep needsConfirmation={needsConfirmation} tenantName={tenant.name} />
          ) : (
            renderStep()
          )}
        </div>

        {status === 'error' && (
          <p className='text-destructive text-center text-sm'>{errorMessage}</p>
        )}

        {!isSuccess && (
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
                onClick={(e) => e.stopPropagation()}
              >
                Terms and Conditions
              </a>
            </span>
          </label>
        )}

        {!isSuccess && (
          <div className='flex justify-between gap-2 pt-2'>
            <Button
              type='button'
              variant='ghost'
              onClick={goBack}
              disabled={currentStep === 0 || isSubmitting}
              className='gap-1'
            >
              <ChevronLeft className='h-4 w-4' />
              Back
            </Button>
            <Button
              type='button'
              onClick={() => (isLastStep ? void submit() : goNext())}
              disabled={!canProceed() || isSubmitting || !agreedToTerms}
              className='gradient-app text-on-brand flex-1 hover:opacity-90 sm:flex-none sm:px-8'
            >
              {isSubmitting ? (
                <span className='flex items-center gap-2'>
                  <Loader2 className='h-4 w-4 animate-spin' />
                  Creating…
                </span>
              ) : isLastStep ? (
                'Sign up'
              ) : (
                'Continue'
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
