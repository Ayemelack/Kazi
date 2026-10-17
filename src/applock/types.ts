export type LockMethod = 'pin' | 'password' | 'fingerprint';

export type SecretKind = 'pin' | 'password';

export interface AppLockConfig {
  enabled: boolean;
  method: LockMethod;
  secretKind: SecretKind;
  salt: string | null;
  hash: string | null;
  failedAttempts: number;
  lockoutUntil: number;
}

export type UnlockResult = 'ok' | 'invalid' | 'locked' | 'unavailable' | 'cancelled';

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 6;
export const PASSWORD_MIN_LENGTH = 6;
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_BASE_MS = 30000;
export const LOCKOUT_MAX_MS = 300000;

export function lockoutDurationFor(attempts: number): number {
  if (attempts < MAX_FAILED_ATTEMPTS) {
    return 0;
  }
  const step = attempts - MAX_FAILED_ATTEMPTS;
  return Math.min(LOCKOUT_BASE_MS * 2 ** step, LOCKOUT_MAX_MS);
}

export function isValidPin(pin: string): boolean {
  return /^\d+$/.test(pin) && pin.length >= PIN_MIN_LENGTH && pin.length <= PIN_MAX_LENGTH;
}

export function isValidAppLockPassword(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH;
}
