import {
  RESET_CODE_LENGTH,
  RESET_CODE_MAX_ATTEMPTS,
  RESET_CODE_TTL_MINUTES,
} from '@kazi/shared';

// Password reset by emailed code (KZ-06).

/** Keeps only digits, at most a code's length: pasted "123 456" becomes "123456". */
export function cleanResetCode(text: string): string {
  return text.replace(/[^0-9]/g, '').slice(0, RESET_CODE_LENGTH);
}

// The API answers RESET_CODE_INVALID for a wrong, expired or used-up code
// alike, so it never reveals whether the account exists. The app knows when
// it asked for the code and how many tries it made, so it can still say which
// one is likely: the translation key to show after `wrongTries` failures.
export function resetCodeFailureKey(
  wrongTries: number,
  requestedAt: number | undefined,
  now: number = Date.now(),
): string {
  if (requestedAt !== undefined && now - requestedAt >= RESET_CODE_TTL_MINUTES * 60 * 1000) {
    return 'auth.errors.codeExpired';
  }
  if (wrongTries >= RESET_CODE_MAX_ATTEMPTS) {
    return 'auth.errors.codeUsedUp';
  }
  return 'auth.errors.codeWrong';
}

// Development builds only: an API started with ALLOW_DEV_RESET_CODE=1 returns
// the code with its 202, and Forgot Password leaves it here for the reset
// screen to prefill, instead of passing it in navigation params. Release
// builds never keep it.
let devCode: string | null = null;

export function holdDevResetCode(code: string | undefined): void {
  devCode = __DEV__ && code !== undefined && cleanResetCode(code) === code ? code : null;
}

/** The held code, once; '' when there is none. */
export function takeDevResetCode(): string {
  const code = devCode ?? '';
  devCode = null;
  return code;
}
