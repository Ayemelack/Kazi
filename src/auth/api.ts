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

export async function logOutAccount(): Promise<void> {
  try {
    await apiRequest<void>('/auth/logout', { method: 'POST', auth: true });
  } catch {
    // The server token is stateless; clearing it locally is the real logout.
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

export function deleteAccount(): Promise<void> {
  return apiRequest<void>('/auth/me', { method: 'DELETE', auth: true });
}