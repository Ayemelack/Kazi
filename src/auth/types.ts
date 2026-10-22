export interface PublicUser {
  id: number;
  firstName: string;
  lastName: string;
  companyName: string;
  businessType: string;
  hasBusiness: boolean;
  email: string;
  language: string;
}

export interface AuthResult {
  token: string;
  /** KZ-13: exchanged for a new pair when the access token expires. */
  refreshToken: string;
  user: PublicUser;
}

/** KZ-13: what POST /auth/refresh returns; the session stays the same. */
export interface RefreshResult {
  token: string;
  refreshToken: string;
}

export interface SignUpInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

export interface LogInInput {
  email: string;
  password: string;
}

export interface ProfileInput {
  companyName: string;
  businessType: string;
}

export interface AccountNamesInput {
  firstName?: string;
  lastName?: string;
}

// KZ-06: the email alone asks for a code; the code from the email and the
// new password finish the reset.
export interface ForgotPasswordInput {
  email: string;
}

export interface ResetPasswordInput {
  email: string;
  code: string;
  password: string;
}

export interface ForgotPasswordResult {
  message: string;
  /** Only from a development API started with ALLOW_DEV_RESET_CODE=1. */
  devCode?: string;
}