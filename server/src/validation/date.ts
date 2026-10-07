import { z } from 'zod';

// Shared business-date rules. A business date is a calendar day in the owner's
// own timezone, always carried as YYYY-MM-DD. It is never a timestamp: the
// record's creation instant lives separately in created_at/paid_at.

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MIN_DATE = '2000-01-01';
const MAX_AHEAD_DAYS = 365;

function parts(value: string): { year: number; month: number; day: number } {
  return {
    year: Number(value.slice(0, 4)),
    month: Number(value.slice(5, 7)),
    day: Number(value.slice(8, 10)),
  };
}

export function localDateString(date: Date = new Date()): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function shiftDate(value: string, days: number): string {
  const { year, month, day } = parts(value);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Rejects impossible calendar days such as 2026-02-30, which the pattern alone
// would accept, by round-tripping through a real Date.
function isCalendarDate(value: string): boolean {
  const { year, month, day } = parts(value);
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isNotTooFarAhead(value: string): boolean {
  const limit = shiftDate(localDateString(), MAX_AHEAD_DAYS);
  return value <= limit;
}

export const businessDateSchema = z
  .string()
  .regex(DATE_PATTERN, 'Date must be in YYYY-MM-DD format.')
  .refine(isCalendarDate, 'Enter a real date.')
  .refine(value => value >= MIN_DATE, 'Date is too far in the past.')
  .refine(isNotTooFarAhead, 'Date cannot be more than a year ahead.');

export type BusinessDateInput = z.infer<typeof businessDateSchema>;
