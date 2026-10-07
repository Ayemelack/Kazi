import type Database from 'better-sqlite3';
import { AppError } from '../errors.js';
import { localDateString, shiftDate } from '../validation/date.js';

export type ActivityType =
  | 'sale'
  | 'spend'
  | 'capital'
  | 'debt_added'
  | 'debt_paid'
  | 'product_added'
  | 'product_updated';

export type HistoryPeriod = 'today' | 'yesterday' | 'this_week' | 'older' | 'all';

export type ActivityRefType = 'transaction' | 'debt' | 'item';

// The event log entry is written in the same transaction as the record that
// caused it, and keeps a loose link back to that record. Deleting the record
// deletes the event too, so "What Happened" can never show something that no
// longer exists and the period totals always agree with /summary.
export interface ActivityRef {
  type: ActivityRefType;
  id: number;
}

export interface ActivityInput {
  type: ActivityType;
  title?: string;
  amount?: number | null;
  quantity?: number | null;
  eventDate?: string | null;
  ref?: ActivityRef;
}

export interface ActivityEvent {
  id: number;
  type: ActivityType;
  title?: string;
  amount?: number;
  quantity?: number;
  eventDate?: string;
  createdAt: string;
}

export interface ActivityFilterOptions {
  period?: HistoryPeriod;
  startDate?: string;
  endDate?: string;
  asOf?: string;
  limit?: number;
  offset?: number;
}

export interface ActivitySummary {
  received: number;
  spent: number;
  made: number;
  capital: number;
}

export interface ActivityResponse {
  events: ActivityEvent[];
  summary: ActivitySummary;
  totalCount: number;
  hasMore: boolean;
}

interface ActivityRow {
  id: number;
  user_id: number;
  type: ActivityType;
  title: string | null;
  amount: number | null;
  quantity: number | null;
  event_date: string | null;
  created_at: string;
}

function toEvent(row: ActivityRow): ActivityEvent {
  const event: ActivityEvent = {
    id: row.id,
    type: row.type,
    createdAt: row.created_at,
  };
  if (row.title !== null) {
    event.title = row.title;
  }
  if (row.amount !== null) {
    event.amount = row.amount;
  }
  if (row.quantity !== null) {
    event.quantity = row.quantity;
  }
  if (row.event_date !== null) {
    event.eventDate = row.event_date;
  }
  return event;
}

// Every event carries a business date. Callers that know the owner's calendar
// day pass it (it is the same date stored on the transaction or debt); callers
// that do not fall back to the server's local day rather than leaving it NULL,
// because history is filtered on event_date alone.
export function logActivity(
  db: Database.Database,
  userId: number,
  input: ActivityInput,
): void {
  db.prepare(
    `INSERT INTO activity (user_id, type, title, amount, quantity, event_date, ref_type, ref_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    userId,
    input.type,
    input.title ?? null,
    input.amount ?? null,
    input.quantity ?? null,
    input.eventDate ?? localDateString(),
    input.ref?.type ?? null,
    input.ref?.id ?? null,
  );
}

// Removes the event log entries produced by a record. Called from inside the
// record's own delete transaction so the two can never drift apart.
export function deleteActivityRefs(
  db: Database.Database,
  userId: number,
  ref: ActivityRef,
): void {
  db.prepare(
    'DELETE FROM activity WHERE user_id = ? AND ref_type = ? AND ref_id = ?',
  ).run(userId, ref.type, ref.id);
}

export function listActivity(
  db: Database.Database,
  userId: number,
  optionsOrLimit: number | ActivityFilterOptions = 50,
): ActivityResponse {
  const options: ActivityFilterOptions =
    typeof optionsOrLimit === 'number'
      ? { limit: optionsOrLimit, offset: 0, period: 'all' }
      : optionsOrLimit;

  if (
    options.startDate &&
    options.endDate &&
    options.startDate > options.endDate
  ) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'startDate must not be after endDate.',
    );
  }

  // Defensive clamping: the query schema already bounds both values, but a
  // non-finite or out-of-int64 OFFSET makes SQLite raise SQLITE_MISMATCH,
  // which would be reported as a 500 rather than a validation error.
  const rawLimit = Number(options.limit ?? 50);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), 200)
    : 50;
  const rawOffset = Number(options.offset ?? 0);
  const offset = Number.isFinite(rawOffset)
    ? Math.min(Math.max(Math.trunc(rawOffset), 0), 1_000_000)
    : 0;
  const period = options.period ?? 'all';

  // Periods are anchored to the caller's calendar day when supplied, so the
  // server's clock and timezone never decide which business day a record
  // belongs to. The server's local day is only the fallback for callers that
  // do not send one.
  const anchor = options.asOf ?? localDateString();
  const yesterdayStr = shiftDate(anchor, -1);
  const weekStartStr = shiftDate(anchor, -6);

  let whereClauses: string[] = ['user_id = ?'];
  let params: (string | number)[] = [userId];

  if (options.startDate && options.endDate) {
    whereClauses.push('event_date BETWEEN ? AND ?');
    params.push(options.startDate, options.endDate);
  } else if (options.startDate) {
    whereClauses.push('event_date >= ?');
    params.push(options.startDate);
  } else if (options.endDate) {
    whereClauses.push('event_date <= ?');
    params.push(options.endDate);
  } else if (period === 'today') {
    whereClauses.push('event_date = ?');
    params.push(anchor);
  } else if (period === 'yesterday') {
    whereClauses.push('event_date = ?');
    params.push(yesterdayStr);
  } else if (period === 'this_week') {
    whereClauses.push('event_date BETWEEN ? AND ?');
    params.push(weekStartStr, anchor);
  } else if (period === 'older') {
    whereClauses.push('event_date < ?');
    params.push(weekStartStr);
  }

  const whereSql = whereClauses.join(' AND ');

  const countRow = db
    .prepare(`SELECT COUNT(*) AS count FROM activity WHERE ${whereSql}`)
    .get(...params) as { count: number };
  const totalCount = Number(countRow.count ?? 0);

  // Fetch summary metrics for this filtered period
  const sumRows = db
    .prepare(
      `SELECT type, COALESCE(SUM(amount), 0) AS total
       FROM activity
       WHERE ${whereSql}
       GROUP BY type`,
    )
    .all(...params) as { type: ActivityType; total: number }[];

  let received = 0;
  let spent = 0;
  let capital = 0;

  for (const row of sumRows) {
    if (row.type === 'sale') {
      received += Number(row.total);
    } else if (row.type === 'spend') {
      spent += Number(row.total);
    } else if (row.type === 'capital') {
      capital += Number(row.total);
    }
  }

  const summary: ActivitySummary = {
    received,
    spent,
    made: received - spent,
    capital,
  };

  const rows = db
    .prepare(
      `SELECT * FROM activity
       WHERE ${whereSql}
       ORDER BY event_date DESC, created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as unknown as ActivityRow[];

  const events = rows.map(toEvent);

  return {
    events,
    summary,
    totalCount,
    hasMore: offset + events.length < totalCount,
  };
}