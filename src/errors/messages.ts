import type { TFunction } from 'i18next';
import { isApiErrorCode, isValidationField, type ApiErrorCode } from '@kazi/shared';
import { ApiError, NetworkError } from './ApiError';

// The one place that turns a failed request into text a user reads (KZ-12).
// It works from the error's code only, never from the server's message, so
// every message follows the app's language. Screens keep the error object in
// state and call this while rendering, so switching language re-translates an
// error that is already on screen.

// A screen may word a code for its own context, for example TOO_MANY_REQUESTS
// means "too many codes asked for" on Forgot Password and "too many tries"
// everywhere else.
export type ErrorKeyOverrides = Partial<Record<ApiErrorCode, string>>;

// A failure the app detects itself (not a request error), kept as a
// translation key so it re-translates like every other error.
export class LocalError extends Error {
  readonly key: string;

  constructor(key: string) {
    super(key);
    this.name = 'LocalError';
    this.key = key;
  }
}

export function errorMessage(
  err: unknown,
  t: TFunction,
  overrides: ErrorKeyOverrides = {},
): string {
  if (err instanceof LocalError) {
    return t(err.key);
  }
  if (err instanceof NetworkError) {
    return t('errors.offline');
  }
  if (err instanceof ApiError) {
    if (err.code === 'SERVER_UNREACHABLE') {
      return t('errors.serverUnreachable');
    }
    if (isApiErrorCode(err.code)) {
      const override = overrides[err.code];
      if (override) {
        return t(override);
      }
      if (err.code === 'VALIDATION_ERROR' && err.rule && isValidationField(err.field)) {
        return t(`errors.validation.${err.rule}`, {
          field: t(`errors.fields.${err.field}`),
        });
      }
      return t(`errors.codes.${err.code}`);
    }
  }
  return t('errors.generic');
}

// Codes whose `field` says where to show them: a VALIDATION_ERROR, and a
// password the API refused as too easy to guess (KZ-05).
const FIELD_CODES: ReadonlySet<string> = new Set(['VALIDATION_ERROR', 'PASSWORD_TOO_COMMON']);

// The request field a failed request is about, so a form can show the
// message under that field instead of at the bottom.
export function errorField(err: unknown): string | undefined {
  return err instanceof ApiError && err.code !== undefined && FIELD_CODES.has(err.code)
    ? err.field
    : undefined;
}
