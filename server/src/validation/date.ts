import { z } from 'zod';
import {
  BUSINESS_DATE_MIN,
  BUSINESS_DATE_PATTERN,
  businessDateMax,
  isCalendarDate,
} from '@kazi/shared';

// Business-date rules shared with the app (@kazi/shared date.ts): a calendar
// day in the owner's own timezone, always YYYY-MM-DD, inside the window
// BUSINESS_DATE_MIN .. today + BUSINESS_DATE_MAX_AHEAD_DAYS. The app's date
// picker offers exactly the same window (KZ-16).
export { localDateString, shiftDate } from '@kazi/shared';

export const businessDateSchema = z
  .string()
  .regex(BUSINESS_DATE_PATTERN, 'Date must be in YYYY-MM-DD format.')
  .refine(isCalendarDate, { message: 'Enter a real date.', params: { rule: 'format' } })
  .refine(value => value >= BUSINESS_DATE_MIN, {
    message: 'Date is too far in the past.',
    params: { rule: 'tooEarly' },
  })
  .refine(value => value <= businessDateMax(), {
    message: 'Date cannot be more than a year ahead.',
    params: { rule: 'tooLate' },
  });

export type BusinessDateInput = z.infer<typeof businessDateSchema>;
