// The API's error contract (KZ-12). Every error response is
// `{ error: { code, message, field?, rule? } }`: `code` is one of
// API_ERROR_CODES and is what the app translates; `message` is English text
// for logs and developers and is never shown to users. Adding a code here
// makes the app's locale test demand a translation for it in every language.

export const API_ERROR_CODES = [
  'VALIDATION_ERROR',
  'EMAIL_IN_USE',
  'INVALID_CREDENTIALS',
  'NOT_FOUND',
  'INVALID_TOKEN',
  'TOKEN_EXPIRED',
  'UNAUTHORIZED',
  'INSUFFICIENT_STOCK',
  'ALREADY_PAID',
  'PASSWORD_TOO_COMMON',
  // A reset code that is wrong, expired, used up or replaced, or an email with
  // no account: one code for all of them, so the answer never reveals which
  // (KZ-06).
  'RESET_CODE_INVALID',
  'TOO_MANY_REQUESTS',
  'PUSH_NOT_CONFIGURED',
  'IDEMPOTENCY_CONFLICT',
  'INTERNAL',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return (API_ERROR_CODES as readonly unknown[]).includes(value);
}

// Why a VALIDATION_ERROR failed, so the app can say it in the user's language
// next to the right field.
export const VALIDATION_RULES = [
  'required',
  'invalid',
  'format',
  'tooShort',
  'tooLong',
  'tooSmall',
  'tooLarge',
  'tooEarly',
  'tooLate',
  'notAllowed',
] as const;

export type ValidationRule = (typeof VALIDATION_RULES)[number];

export function isValidationRule(value: unknown): value is ValidationRule {
  return (VALIDATION_RULES as readonly unknown[]).includes(value);
}

// Every request field the API validates. `field` in a VALIDATION_ERROR is one
// of these (the first segment of the failing path), and the app has a label
// for each one.
export const VALIDATION_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'password',
  'code',
  'token',
  'companyName',
  'businessType',
  'language',
  'name',
  'type',
  'price',
  'notes',
  'trackStock',
  'image',
  'quantity',
  'lowStockThreshold',
  'reason',
  'amount',
  'date',
  'description',
  'itemId',
  'clientOpId',
  'note',
  'status',
  'rating',
  'liked',
  'disliked',
  'suggestion',
  'platform',
  'title',
  'body',
  'period',
  'startDate',
  'endDate',
  'asOf',
  'limit',
  'offset',
  'pushNotifications',
] as const;

export type ValidationField = (typeof VALIDATION_FIELDS)[number];

export function isValidationField(value: unknown): value is ValidationField {
  return (VALIDATION_FIELDS as readonly unknown[]).includes(value);
}

export interface ApiErrorBody {
  code: ApiErrorCode;
  message: string;
  field?: string;
  rule?: ValidationRule;
}
