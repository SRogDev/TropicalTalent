'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signUpAction } from '@/modules/identity/actions';
import { clearStoredReferral } from './referral-field';

export type SignUpRole = 'creative' | 'brand';
export type SubmitStatus = 'idle' | 'submitting' | 'success' | 'error';

export interface SignUpFormState {
  currentStep: number;
  name: string;
  email: string;
  password: string;
  role: SignUpRole | null;
  companyBlurb: string;
  photoFile: File | null;
  photoPreview: string;
  passions: string[];
  bio: string;
  locationText: string;
  referralCode: string;
}

const initialState: SignUpFormState = {
  currentStep: 0,
  name: '',
  email: '',
  password: '',
  role: null,
  companyBlurb: '',
  photoFile: null,
  photoPreview: '',
  passions: [],
  bio: '',
  locationText: '',
  referralCode: '',
};

/**
 * Who this workspace offers referrals to, by side of the marketplace.
 *
 * Computed server-side by referralAudience() in modules/tenancy/presets.ts —
 * `payer` is the tenant's referrals feature, `worker` is that AND not a
 * contractor workspace. Both default true so the classic dialog, which passes
 * no tenant at all, behaves exactly as it always has.
 */
export interface ReferralAudience {
  worker: boolean;
  payer: boolean;
}

export const ALL_REFERRALS: ReferralAudience = { worker: true, payer: true };

/**
 * Whether this sign-up ends with the referral step.
 *
 * Step 0: Name, 1: Email + password, 2: Role, then the branch-specific steps,
 * and the referral code last on both branches when it runs at all.
 */
export function hasReferralStep(
  role: SignUpRole | null,
  referrals: ReferralAudience = ALL_REFERRALS,
): boolean {
  if (role === 'brand') return referrals.payer;
  if (role === 'creative') return referrals.worker;
  return false;
}

export function getTotalSteps(
  role: SignUpRole | null,
  referrals: ReferralAudience = ALL_REFERRALS,
) {
  // The referral step is the last one on both branches, so dropping it is a
  // subtraction rather than a re-ordering.
  const referral = hasReferralStep(role, referrals) ? 1 : 0;
  if (role === 'brand') return 4 + referral; // + company blurb
  if (role === 'creative') return 7 + referral; // + photo, passion, bio, location
  return 3;
}

/**
 * The sign-up wizard's state.
 *
 * Same step shape as the waitlist form it replaces, with a password added to
 * the email step — real auth needs one, and folding it into an existing step
 * keeps the flow the same length.
 */
export function useSignUpForm(referrals: ReferralAudience = ALL_REFERRALS) {
  const router = useRouter();
  const [state, setState] = useState<SignUpFormState>(initialState);
  const [status, setStatus] = useState<SubmitStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [needsConfirmation, setNeedsConfirmation] = useState(false);

  const update = useCallback(
    <K extends keyof SignUpFormState>(key: K, value: SignUpFormState[K]) => {
      setState((prev) => (prev[key] === value ? prev : { ...prev, [key]: value }));
    },
    [],
  );

  const goNext = useCallback(
    () => setState((prev) => ({ ...prev, currentStep: prev.currentStep + 1 })),
    [],
  );

  const goBack = useCallback(
    () => setState((prev) => ({ ...prev, currentStep: Math.max(0, prev.currentStep - 1) })),
    [],
  );

  const reset = useCallback(() => {
    setState(initialState);
    setStatus('idle');
    setErrorMessage('');
    setNeedsConfirmation(false);
  }, []);

  const submit = useCallback(async () => {
    setStatus('submitting');
    setErrorMessage('');

    const form = new FormData();
    form.set('name', state.name);
    form.set('email', state.email);
    form.set('password', state.password);
    form.set('role', state.role ?? '');

    if (state.role === 'brand') {
      form.set('companyBlurb', state.companyBlurb);
    } else if (state.role === 'creative') {
      form.set('passions', JSON.stringify(state.passions));
      form.set('bio', state.bio);
      if (state.locationText.trim()) form.set('locationText', state.locationText.trim());
      if (state.photoFile) form.set('photo', state.photoFile);
    }

    if (state.referralCode.trim()) {
      form.set('referralCode', state.referralCode.trim());
    }

    const result = await signUpAction(form);

    if (result.success !== true) {
      setStatus('error');
      setErrorMessage(result.error);
      return;
    }

    // The code has been spent; a later visit in this session should not
    // re-attribute a second signup to the same referrer.
    clearStoredReferral();

    setNeedsConfirmation(result.data.needsEmailConfirmation);
    setStatus('success');

    // A session was issued, so the account is usable now. One navigation, not
    // a refresh racing a push — see the note in sign-in-form.tsx for why the
    // pair left the transition pending and froze the button.
    if (!result.data.needsEmailConfirmation) {
      router.replace(result.data.next);
    }
  }, [state, router]);

  return useMemo(
    () => ({
      state,
      update,
      totalSteps: getTotalSteps(state.role, referrals),
      goNext,
      goBack,
      submit,
      status,
      errorMessage,
      needsConfirmation,
      reset,
    }),
    [
      state,
      update,
      // The primitives, not the object: callers pass a fresh literal on every
      // render, and depending on its identity would defeat the memo.
      referrals.worker,
      referrals.payer,
      goNext,
      goBack,
      submit,
      status,
      errorMessage,
      needsConfirmation,
      reset,
    ],
  );
}
