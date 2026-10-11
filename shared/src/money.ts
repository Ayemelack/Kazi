// Money is a whole number of FCFA from the keyboard to the database (ADR A6).
// FCFA has no minor unit, so "1,000" and "1.000" can only mean one thousand.

/** Largest amount or price either side accepts. */
export const MONEY_MAX = 1_000_000_000_000;

/**
 * Separator between digit groups and before "FCFA": the narrow no-break space
 * (U+202F), French typography's thousands separator. Being no-break, an amount
 * never wraps across two lines.
 */
export const MONEY_SEPARATOR = '\u202f';

// Every kind of space a keyboard or a paste can produce: ASCII space, tab,
// no-break space (U+00A0), narrow no-break space (U+202F) and the rest of \s.
const SPACES = /\s/g;
const DIGITS = /^\d+$/;
// One to three leading digits (no leading zero), then groups of exactly three,
// all separated by the same character: a comma or a dot.
const GROUPED = /^[1-9]\d{0,2}(?:([,.])\d{3})(?:\1\d{3})*$/;

/**
 * Reads what the user typed into a money field as whole FCFA.
 *
 * Spaces are ignored. "," or "." are accepted only as thousands separators in
 * groups of three ("1,000", "1.000.000"); one kind per number. Anything else —
 * decimals, exponents, hex, signs, empty text — returns null rather than a
 * guess. Range checks (> 0, <= MONEY_MAX) are the caller's job.
 */
export function parseMoneyInput(text: string): number | null {
  if (typeof text !== 'string') {
    return null;
  }
  const compact = text.replace(SPACES, '');
  let digits: string;
  if (DIGITS.test(compact)) {
    digits = compact;
  } else if (GROUPED.test(compact)) {
    digits = compact.replace(/[,.]/g, '');
  } else {
    return null;
  }
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
}

/** Formats whole FCFA for display: "1 000 FCFA" (narrow no-break spaces). */
export function formatMoney(amount: number): string {
  const whole = Number.isFinite(amount) ? Math.round(amount) : 0;
  const sign = whole < 0 ? '-' : '';
  const grouped = String(Math.abs(whole)).replace(/\B(?=(\d{3})+(?!\d))/g, MONEY_SEPARATOR);
  return `${sign}${grouped}${MONEY_SEPARATOR}FCFA`;
}
