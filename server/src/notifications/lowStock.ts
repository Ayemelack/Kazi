import type Database from 'better-sqlite3';
import { isAppLanguage } from '@kazi/shared';
import { AppError } from '../errors.js';
import { log } from '../log.js';
import { lowStockMessage } from './lowStockMessage.js';
import { PUSH_TIMEOUT_MS, pushMessagingFor, sendNotificationToUser } from './service.js';

// KZ-03 (decision D6): the low-stock push. When a sale, a manual stock-out or
// a purchase reversal takes a tracked item from above its threshold to at or
// below it, the owner's devices get one alert, at most once per item per
// 12 hours.
//
// The write never waits for it and never fails because of it. better-sqlite3
// is synchronous, so a job queued with setImmediate from inside a write runs
// only after the request's outermost transaction has committed or rolled back.
// The job re-reads the item, so a rolled-back write (stock back above the
// threshold) sends nothing.

export const LOW_STOCK_ALERT_INTERVAL_MS = 12 * 60 * 60 * 1000;

export interface StockLevel {
  track_stock: number;
  low_stock_threshold: number;
}

/** True when this change takes the item from above its threshold to at or below it. */
export function crossesLowStock(item: StockLevel, before: number, after: number): boolean {
  const threshold = item.low_stock_threshold;
  return item.track_stock === 1 && threshold > 0 && before > threshold && after <= threshold;
}

const inFlight = new Set<Promise<void>>();

/** Sends the alert after the current request's transaction; never throws. */
export function queueLowStockAlert(db: Database.Database, userId: number, itemId: number): void {
  setImmediate(() => {
    const job = sendLowStockAlert(db, userId, itemId)
      .then(
        () => undefined,
        (error: unknown) => {
          log.warn(`Low-stock alert for user ${userId} was not delivered: ${describe(error)}`);
        },
      )
      .finally(() => inFlight.delete(job));
    inFlight.add(job);
  });
}

/** Resolves once every queued alert has finished (tests, shutdown). */
export async function settleLowStockAlerts(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
  while (inFlight.size > 0) {
    await Promise.all([...inFlight]);
  }
}

export type LowStockAlertOutcome = 'sent' | 'no-devices' | 'not-configured' | 'skipped';

export async function sendLowStockAlert(
  db: Database.Database,
  userId: number,
  itemId: number,
  now = Date.now(),
  timeoutMs = PUSH_TIMEOUT_MS,
): Promise<LowStockAlertOutcome> {
  const devices = db
    .prepare('SELECT COUNT(*) AS n FROM push_tokens WHERE user_id = ?')
    .get(userId) as { n: number };
  if (devices.n === 0) {
    return 'no-devices';
  }

  // Resolve the sender before claiming the 12-hour slot, so a server without
  // Firebase credentials doesn't use it up.
  try {
    pushMessagingFor(db);
  } catch (error) {
    if (error instanceof AppError && error.code === 'PUSH_NOT_CONFIGURED') {
      return 'not-configured';
    }
    throw error;
  }

  // Claim the slot and re-check the item in one statement: still tracked,
  // still at or below its threshold, and no alert in the last 12 hours. Two
  // jobs for the same item can't both win.
  const claimed = db
    .prepare(
      `UPDATE items SET last_low_stock_alert_at = ?
       WHERE id = ? AND user_id = ?
         AND track_stock = 1 AND low_stock_threshold > 0 AND stock <= low_stock_threshold
         AND (last_low_stock_alert_at IS NULL OR last_low_stock_alert_at <= ?)`,
    )
    .run(now, itemId, userId, now - LOW_STOCK_ALERT_INTERVAL_MS);
  if (claimed.changes !== 1) {
    return 'skipped';
  }

  const row = db
    .prepare(
      `SELECT i.name, i.stock, u.language
       FROM items i JOIN users u ON u.id = i.user_id
       WHERE i.id = ? AND i.user_id = ?`,
    )
    .get(itemId, userId) as { name: string; stock: number; language: string } | undefined;
  if (!row) {
    return 'skipped';
  }

  const language = isAppLanguage(row.language) ? row.language : 'en';
  await sendNotificationToUser(db, userId, {
    ...lowStockMessage(row.name, row.stock, language),
    data: { type: 'low_stock', itemId: String(itemId) },
  }, timeoutMs);
  return 'sent';
}

// Error codes and messages only: never the item, the user's data or a token.
function describe(error: unknown): string {
  if (error instanceof AppError) {
    return error.code;
  }
  if (error instanceof Error) {
    return error.name;
  }
  return 'unknown error';
}
