import type Database from 'better-sqlite3';

// The per-account notification history behind More > Notifications (decision
// C2). A row is written by deliverPush when at least one device accepted the
// message, so the centre lists what was actually sent, never what was
// attempted. Rows are pruned to the newest KEEP_PER_USER per account when a
// new one lands: a 12-hour low-stock cadence keeps the table small without a
// background job.

/** Rows kept per account; older ones are dropped when a new one is written. */
export const KEEP_PER_USER = 200;

/** The default and maximum page sizes the history endpoint serves. */
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

export interface NotificationRecord {
  /** low_stock today; null for a plain display-only message. */
  type: string | null;
  /** The record the push is about (low_stock's item), when it names one. */
  itemId: number | null;
  title: string;
  body: string;
}

export interface StoredNotification {
  id: number;
  type: string | null;
  itemId: number | null;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
}

/**
 * Remembers one delivered push. Best-effort: a history write that fails must
 * never turn a delivered push into an error for its sender.
 */
export function recordNotification(
  db: Database.Database,
  userId: number,
  record: NotificationRecord,
): void {
  try {
    db.prepare(
      'INSERT INTO user_notifications (user_id, type, item_id, title, body) VALUES (?, ?, ?, ?, ?)',
    ).run(userId, record.type, record.itemId, record.title, record.body);
    db.prepare(
      `DELETE FROM user_notifications
        WHERE user_id = ?
          AND id NOT IN (SELECT id FROM user_notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?)`,
    ).run(userId, userId, KEEP_PER_USER);
  } catch {
    // Best-effort: the push already reached the devices.
  }
}

/** The newest notifications for an account, newest first. */
export function listNotifications(
  db: Database.Database,
  userId: number,
  limit: number,
): StoredNotification[] {
  const rows = db
    .prepare(
      `SELECT id, type, item_id, title, body, created_at, read_at
         FROM user_notifications
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT ?`,
    )
    .all(userId, limit) as unknown as {
    id: number;
    type: string | null;
    item_id: number | null;
    title: string;
    body: string;
    created_at: string;
    read_at: string | null;
  }[];
  return rows.map(row => ({
    id: row.id,
    type: row.type,
    itemId: row.item_id,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    read: row.read_at !== null,
  }));
}

/** How many notifications the account has not read yet. */
export function unreadCount(db: Database.Database, userId: number): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM user_notifications WHERE user_id = ? AND read_at IS NULL')
    .get(userId) as { n: number };
  return row.n;
}

/** Marks every unread notification as read; returns how many changed. */
export function markAllRead(db: Database.Database, userId: number): number {
  return db
    .prepare(
      "UPDATE user_notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL",
    )
    .run(userId).changes;
}
