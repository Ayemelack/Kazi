import type { TFunction } from 'i18next';
import { ApiError } from '../errors/ApiError';

const CODE_TO_KEY: Record<string, string> = {
  EMAIL_IN_USE: 'auth.errors.emailInUse',
  INVALID_CREDENTIALS: 'auth.errors.invalidCredentials',
  INVALID_TOKEN: 'auth.errors.tokenInvalid',
  TOKEN_EXPIRED: 'auth.errors.tokenExpired',
  INSUFFICIENT_STOCK: 'products.errors.insufficientStock',
  ALREADY_PAID: 'debts.errors.alreadyPaid',
  TOO_MANY_REQUESTS: 'auth.errors.tooManyRequests',
};

export function apiErrorMessage(err: unknown, t: TFunction): string {
  if (err instanceof ApiError && err.code) {
    const key = CODE_TO_KEY[err.code];
    if (key) {
      return t(key);
    }
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return t('auth.errors.generic');
}