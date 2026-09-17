import { z } from 'zod';

const EMAIL_MAX = 254;
const NAME_MIN = 1;
const NAME_MAX = 50;
const COMPANY_NAME_MIN = 2;
const COMPANY_NAME_MAX = 100;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72;

// Letters (including accented letters used in French), spaces, hyphens and
// apostrophes. Digits and symbols are rejected so names cannot hide numbers.
const NAME_PATTERN = /^[\p{L}][\p{L}\s'’-]*$/u;

const trimmedString = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min, `Must be at least ${min} characters.`)
    .max(max, `Must be at most ${max} characters.`);

const nameSchema = z
  .string()
  .trim()
  .min(NAME_MIN, 'Name is required.')
  .max(NAME_MAX, `Name must be at most ${NAME_MAX} characters.`)
  .regex(NAME_PATTERN, 'Names can only contain letters, spaces, hyphens and apostrophes.');

const emailSchema = z
  .string()
  .trim()
  .min(1, 'Email is required.')
  .max(EMAIL_MAX, `Email is too long (max ${EMAIL_MAX} characters).`)
  .email('Enter a valid email address.')
  .transform(value => value.toLowerCase());

const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters.`)
  .max(PASSWORD_MAX, `Password is too long (max ${PASSWORD_MAX} characters).`)
  .regex(/[a-zA-Z]/, 'Password must contain at least one letter.')
  .regex(/[0-9]/, 'Password must contain at least one number.');

export const businessTypeSchema = z
  .string()
  .trim()
  .min(1, 'Business type is required.')
  .max(60, 'Business type is too long.');

export const signupSchema = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required.'),
});

export const forgotPasswordSchema = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(10, 'Reset code is required.'),
  password: passwordSchema,
});

export const profileSchema = z.object({
  companyName: trimmedString(COMPANY_NAME_MIN, COMPANY_NAME_MAX),
  businessType: businessTypeSchema,
});

// Allows updating the visible name fields used by the account. Attempting to
// change email or password through this endpoint is rejected by the strict
// shape (unexpected fields are stripped by zod).
export const accountSchema = z.object({
  firstName: nameSchema.optional(),
  lastName: nameSchema.optional(),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ProfileInput = z.infer<typeof profileSchema>;
export type AccountInput = z.infer<typeof accountSchema>;

export function validate<T>(schema: z.ZodType<T>, data: unknown): T {
  return schema.parse(data);
}