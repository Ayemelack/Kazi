import { shiftDate } from '@kazi/shared';

// KZ-28: the dates History asks for under "Older".
//
// "This week" is the seven days ending today (the server's `this_week` uses
// the same window), so "Older" ends the day before it starts, today − 7. A
// From date alone runs up to that day; a To date is capped at it, so "Older"
// never shows anything from this week. An impossible range is a validation
// error the screen shows under the From field instead of asking the server.

export type OlderRangeError = 'fromAfterTo' | 'fromInThisWeek';

export type OlderRange =
  | { ok: true; startDate?: string; endDate: string }
  | { ok: false; error: OlderRangeError; lastOlderDay: string };

export function lastOlderDay(today: string): string {
  return shiftDate(today, -7);
}

export function olderRange(today: string, from: string, to: string): OlderRange {
  const last = lastOlderDay(today);
  if (from !== '' && to !== '' && from > to) {
    return { ok: false, error: 'fromAfterTo', lastOlderDay: last };
  }
  const endDate = to !== '' && to < last ? to : last;
  if (from !== '' && from > endDate) {
    return { ok: false, error: 'fromInThisWeek', lastOlderDay: last };
  }
  return { ok: true, startDate: from === '' ? undefined : from, endDate };
}
