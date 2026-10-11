// Business dates: a calendar day in the owner's own timezone, always carried
// as YYYY-MM-DD. Never a timestamp: the record's creation instant lives
// separately in created_at/paid_at. The app's date picker and the API both
// enforce the same window (KZ-16).

export const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Earliest business date either side accepts. */
export const BUSINESS_DATE_MIN = '2000-01-01';
/** How far ahead of the caller's today a business date may be. */
export const BUSINESS_DATE_MAX_AHEAD_DAYS = 365;

function parts(value: string): { year: number; month: number; day: number } {
  return {
    year: Number(value.slice(0, 4)),
    month: Number(value.slice(5, 7)),
    day: Number(value.slice(8, 10)),
  };
}

/** The local calendar day of `date` as YYYY-MM-DD. */
export function localDateString(date: Date = new Date()): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Adds `days` (may be negative) to a YYYY-MM-DD date. */
export function shiftDate(value: string, days: number): string {
  const { year, month, day } = parts(value);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * True for a real calendar day in YYYY-MM-DD form. Rejects impossible days
 * such as 2026-02-30, which the pattern alone would accept, by round-tripping
 * through a real Date.
 */
export function isCalendarDate(value: string): boolean {
  if (!BUSINESS_DATE_PATTERN.test(value)) {
    return false;
  }
  const { year, month, day } = parts(value);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Latest business date allowed when the caller's today is `today`. */
export function businessDateMax(today: string = localDateString()): string {
  return shiftDate(today, BUSINESS_DATE_MAX_AHEAD_DAYS);
}

/** True when `value` lies inside [BUSINESS_DATE_MIN, businessDateMax(today)]. */
export function isWithinBusinessDateWindow(
  value: string,
  today: string = localDateString(),
): boolean {
  return value >= BUSINESS_DATE_MIN && value <= businessDateMax(today);
}
