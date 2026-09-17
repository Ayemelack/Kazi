import type Database from 'better-sqlite3';

export type ActivityType =
  | 'sale'
  | 'spend'
  | 'capital'
  | 'debt_added'
  | 'debt_paid'
  | 'product_added'
  | 'product_updated';

export interface ActivityInput {
  type: ActivityType;
  title?: string;
  amount?: number | null;
  quantity?: number | null;
  eventDate?: string | null;
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

// History is derived from real business events. A minimal activity table
// records them so "What Happened" can show sales, spending, debt and product
// events without duplicating full domain tables.
export function logActivity(
  db: Database.Database,
  userId: number,
  input: ActivityInput,
): void {
  db.prepare(
    `INSERT INTO activity (user_id, type, title, amount, quantity, event_date)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    userId,
    input.type,
    input.title ?? null,
    input.amount ?? null,
    input.quantity ?? null,
    input.eventDate ?? null,
  );
}

export function listActivity(
  db: Database.Database,
  userId: number,
  limit = 100,
): ActivityEvent[] {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    limit = 100;
  }
  const rows = db
    .prepare(
      `SELECT * FROM activity
       WHERE user_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .all(userId, Math.min(limit, 200)) as unknown as ActivityRow[];
  return rows.map(toEvent);
}