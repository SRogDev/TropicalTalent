import { z } from 'zod';

/**
 * Sign-up validation.
 *
 * The step schemas are exported individually because the dialog uses them to
 * decide whether "Continue" is enabled — the same rules the server enforces,
 * so a step can never pass in the UI and fail on submit.
 */

export const nameStepSchema = z.object({
  name: z.string().min(1, 'Please share your name').max(100, 'Name must not exceed 100 characters'),
});

export const emailStepSchema = z.object({
  email: z.string().min(1, 'Please share your email').email('Enter a valid email address'),
  password: z.string().min(8, 'Use at least 8 characters'),
});

export const brandBlurbStepSchema = z.object({
  companyBlurb: z
    .string()
    .min(1, 'Tell us a little about your company')
    .max(280, 'Keep it to 1-2 sentences (280 characters max)'),
});

export const passionStepSchema = z.object({
  passions: z.array(z.string().min(1)).min(1, 'Select at least one'),
});

export const bioStepSchema = z.object({
  bio: z
    .string()
    .min(1, 'Tell us a little about your style or what you do')
    .max(280, 'Keep it to 1-2 sentences (280 characters max)'),
});

const base = z.object({
  name: nameStepSchema.shape.name,
  email: emailStepSchema.shape.email,
  password: emailStepSchema.shape.password,
});

export const brandSignUpSchema = base.extend({
  role: z.literal('brand'),
  companyBlurb: brandBlurbStepSchema.shape.companyBlurb,
});

export const creativeSignUpSchema = base.extend({
  role: z.literal('creative'),
  passions: passionStepSchema.shape.passions,
  bio: bioStepSchema.shape.bio,
  locationText: z.string().optional(),
});

export const signUpSchema = z
  .discriminatedUnion('role', [brandSignUpSchema, creativeSignUpSchema])
  .refine(
    (data) => data.role !== 'creative' || (!!data.locationText && data.locationText.trim() !== ''),
    { message: 'Please share your location', path: ['locationText'] },
  );

export type SignUpInput = z.infer<typeof signUpSchema>;

/**
 * The same profile questions, minus the credentials.
 *
 * An OAuth user arrives already authenticated with a name and an email from
 * Google, but with no role and none of the role-specific detail the product
 * runs on. This is what /auth/complete collects.
 */
const completeBase = z.object({ name: nameStepSchema.shape.name });

export const completeProfileSchema = z
  .discriminatedUnion('role', [
    completeBase.extend({
      role: z.literal('brand'),
      companyBlurb: brandBlurbStepSchema.shape.companyBlurb,
    }),
    completeBase.extend({
      role: z.literal('creative'),
      passions: passionStepSchema.shape.passions,
      bio: bioStepSchema.shape.bio,
      locationText: z.string().optional(),
    }),
  ])
  .refine(
    (data) => data.role !== 'creative' || (!!data.locationText && data.locationText.trim() !== ''),
    { message: 'Please share your location', path: ['locationText'] },
  );

export type CompleteProfileInput = z.infer<typeof completeProfileSchema>;
