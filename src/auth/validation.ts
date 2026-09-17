import type {
  ForgotPasswordInput,
  LogInInput,
  ProfileInput,
  ResetPasswordInput,
  SignUpInput,
} from './types';

export type AuthField =
  | 'firstName'
  | 'lastName'
  | 'companyName'
  | 'businessType'
  | 'email'
  | 'password'
  | 'confirmPassword'
  | 'token';
export type AuthFieldErrors = Partial<Record<AuthField, string>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Letters (including accented letters used in French), spaces, hyphens and
// apostrophes. Digits and symbols are rejected so names cannot hide numbers.
const NAME_PATTERN = /^[\p{L}][\p{L}\s’'’-]*$/u;

export function validateName(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return 'auth.errors.required';
  }
  if (trimmed.length > 50) {
    return 'auth.errors.nameMax';
  }
  if (!NAME_PATTERN.test(trimmed)) {
    return 'auth.errors.nameInvalid';
  }
  return null;
}

export function validateCompanyName(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return 'auth.errors.required';
  }
  if (trimmed.length < 2) {
    return 'auth.errors.companyNameMin';
  }
  if (trimmed.length > 100) {
    return 'auth.errors.companyNameMax';
  }
  return null;
}

export function validateBusinessType(value: string): string | null {
  if (value.trim().length === 0) {
    return 'auth.errors.required';
  }
  return null;
}

export function validateEmail(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return 'auth.errors.required';
  }
  if (!EMAIL_PATTERN.test(trimmed) || trimmed.length > 254) {
    return 'auth.errors.emailInvalid';
  }
  return null;
}

export function validatePassword(value: string): string | null {
  if (value.length === 0) {
    return 'auth.errors.required';
  }
  if (value.length < 8) {
    return 'auth.errors.passwordMin';
  }
  if (/[a-zA-Z]/.test(value) === false) {
    return 'auth.errors.passwordLetter';
  }
  if (/[0-9]/.test(value) === false) {
    return 'auth.errors.passwordNumber';
  }
  return null;
}

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
}

export function passwordStrength(value: string): PasswordStrength {
  const checks = [
    value.length >= 8,
    /[a-zA-Z]/.test(value),
    /[0-9]/.test(value),
    /(?=[A-Z])|(?=[^a-zA-Z0-9])/.test(value),
  ];
  const score = checks.filter(Boolean).length as 0 | 1 | 2 | 3 | 4;
  const label =
    score <= 1
      ? 'weak'
      : score === 2
      ? 'fair'
      : score === 3
      ? 'good'
      : 'strong';
  return { score, label };
}

export function validateSignup(input: SignUpInput): AuthFieldErrors {
  const errors: AuthFieldErrors = {};
  const firstNameError = validateName(input.firstName);
  if (firstNameError) {
    errors.firstName = firstNameError;
  }
  const lastNameError = validateName(input.lastName);
  if (lastNameError) {
    errors.lastName = lastNameError;
  }
  const emailError = validateEmail(input.email);
  if (emailError) {
    errors.email = emailError;
  }
  const passwordError = validatePassword(input.password);
  if (passwordError) {
    errors.password = passwordError;
  }
  return errors;
}

export function validateLogin(input: LogInInput): AuthFieldErrors {
  const errors: AuthFieldErrors = {};
  const emailError = validateEmail(input.email);
  if (emailError) {
    errors.email = emailError;
  }
  if (input.password.length === 0) {
    errors.password = 'auth.errors.required';
  }
  return errors;
}

export function validateForgotPassword(input: ForgotPasswordInput): AuthFieldErrors {
  const errors: AuthFieldErrors = {};
  const firstNameError = validateName(input.firstName);
  if (firstNameError) {
    errors.firstName = firstNameError;
  }
  const lastNameError = validateName(input.lastName);
  if (lastNameError) {
    errors.lastName = lastNameError;
  }
  const emailError = validateEmail(input.email);
  if (emailError) {
    errors.email = emailError;
  }
  return errors;
}

export function validateResetPassword(
  input: Pick<ResetPasswordInput, 'password'>,
): AuthFieldErrors {
  const errors: AuthFieldErrors = {};
  const passwordError = validatePassword(input.password);
  if (passwordError) {
    errors.password = passwordError;
  }
  return errors;
}

export function validateProfile(input: ProfileInput): AuthFieldErrors {
  const errors: AuthFieldErrors = {};
  const companyNameError = validateCompanyName(input.companyName);
  if (companyNameError) {
    errors.companyName = companyNameError;
  }
  const businessTypeError = validateBusinessType(input.businessType);
  if (businessTypeError) {
    errors.businessType = businessTypeError;
  }
  return errors;
}

export interface AccountProfileInput {
  companyName: string;
  businessType: string;
  firstName: string;
  lastName: string;
}

export function validateAccountProfile(input: AccountProfileInput): AuthFieldErrors {
  const errors: AuthFieldErrors = {};
  const companyNameError = validateCompanyName(input.companyName);
  if (companyNameError) {
    errors.companyName = companyNameError;
  }
  const businessTypeError = validateBusinessType(input.businessType);
  if (businessTypeError) {
    errors.businessType = businessTypeError;
  }
  const firstNameError = validateName(input.firstName);
  if (firstNameError) {
    errors.firstName = firstNameError;
  }
  const lastNameError = validateName(input.lastName);
  if (lastNameError) {
    errors.lastName = lastNameError;
  }
  return errors;
}

export function hasErrors(errors: AuthFieldErrors): boolean {
  return Object.keys(errors).length > 0;
}