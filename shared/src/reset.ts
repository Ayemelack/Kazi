// Password reset by a code sent out of band (KZ-06, decision D2: email). The
// API enforces these; the app uses them to word its messages and to size the
// code field, so the two can't disagree.

/** Digits in a reset code. */
export const RESET_CODE_LENGTH = 6;

/** How long a code works after it is issued. */
export const RESET_CODE_TTL_MINUTES = 15;

/** Wrong tries a code survives; after this many it never works again. */
export const RESET_CODE_MAX_ATTEMPTS = 5;

/** Codes that may be requested for one email address per hour. */
export const RESET_CODES_PER_EMAIL_PER_HOUR = 3;

/**
 * Codes that may be requested for one email address per day (KZ-08), which
 * caps online guessing at 50 tries a day (SECURITY.md §6).
 */
export const RESET_CODES_PER_EMAIL_PER_DAY = 10;

/** True when `value` has the shape of a reset code (exactly six ASCII digits). */
export function isResetCodeFormat(value: string): boolean {
  return value.length === RESET_CODE_LENGTH && /^[0-9]+$/.test(value);
}
