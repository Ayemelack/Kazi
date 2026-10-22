import type { AppLanguage } from '@kazi/shared';
import { apiRequest } from '../api/client';
import type {
  AccountNamesInput,
  AuthResult,
  ForgotPasswordInput,
  ForgotPasswordResult,
  LogInInput,
  ProfileInput,
  ResetPasswordInput,
  SignUpInput,
} from './types';

export function signUpAccount(input: SignUpInput): Promise<AuthResult> {
  return apiRequest<AuthResult>('/auth/signup', {
    method: 'POST',
    body: input,
    auth: false,
  });
}

export function logInAccount(input: LogInInput): Promise<AuthResult> {
  return apiRequest<AuthResult>('/auth/login', {
    method: 'POST',
    body: input,
    auth: false,
  });
}

// KZ-13: revokes the server-side session. The refresh token proves ownership,
// so this works even after the 15-minute access token has expired.
export async function logOutAccount(refreshToken: string | null): Promise<void> {
  try {
    await apiRequest<void>('/auth/logout', {
      method: 'POST',
      auth: false,
      body: refreshToken === null ? undefined : { refreshToken },
    });
  } catch {
    // Logging out of this phone must succeed even when the server is down.
  }
}

export function requestPasswordReset(
  input: ForgotPasswordInput,
): Promise<ForgotPasswordResult> {
  return apiRequest<ForgotPasswordResult>('/auth/forgot-password', {
    method: 'POST',
    body: input,
    auth: false,
  });
}

export function resetPassword(input: ResetPasswordInput): Promise<{ message: string }> {
  return apiRequest<{ message: string }>('/auth/reset-password', {
    method: 'POST',
    body: input,
    auth: false,
  });
}

export function fetchCurrentUser(): Promise<{ user: AuthResult['user'] }> {
  return apiRequest<{ user: AuthResult['user'] }>('/auth/me', { auth: true });
}

export function updateProfile(input: ProfileInput): Promise<{ user: AuthResult['user'] }> {
  return apiRequest<{ user: AuthResult['user'] }>('/auth/me', {
    method: 'PATCH',
    body: input,
    auth: true,
  });
}

export function updateAccountNames(
  input: AccountNamesInput,
): Promise<{ user: AuthResult['user'] }> {
  return apiRequest<{ user: AuthResult['user'] }>('/auth/me/names', {
    method: 'PATCH',
    body: input,
    auth: true,
  });
}

export function updateLanguage(language: AppLanguage): Promise<{ user: AuthResult['user'] }> {
  return apiRequest<{ user: AuthResult['user'] }>('/auth/me/language', {
    method: 'PATCH',
    body: { language },
    auth: true,
  });
}

// The server checks the password before deleting anything (KZ-20).
export function deleteAccount(password: string): Promise<void> {
  return apiRequest<void>('/auth/me', { method: 'DELETE', body: { password }, auth: true });
}