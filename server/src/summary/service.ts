import type Database from 'better-sqlite3';
import { localDateString } from '../validation/date.js';

export interface MoneySummary {
  todayReceived: number;
  todaySpent: number;
  todayNet: number;
  totalReceived: number;
  totalSpent: number;
  totalNet: number;
  totalCapital: number;
  // Tracked items at or under their low-stock threshold (threshold > 0): the
  // same rule as an item's `lowStock` flag, so Home needs no /items call.
  lowStockCount: number;
}

interface SummaryRow {
  todayReceived: number;
  todaySpent: number;
  totalReceived: number;
  totalSpent: number;
  totalCapital: number;
  lowStockCount: number;
}

// One statement for the whole dashboard (KZ-10, and the single-query part of
// KZ-32): a single pass over the user's transactions through
// idx_transactions_user_type_date, plus a correlated count over the user's
// items through idx_items_user.
const SUMMARY_SQL = `
  SELECT
    COALESCE(SUM(CASE WHEN type = 'sale' AND date = @asOf THEN amount END), 0) AS todayReceived,
    COALESCE(SUM(CASE WHEN type = 'purchase' AND date = @asOf THEN amount END), 0) AS todaySpent,
    COALESCE(SUM(CASE WHEN type = 'sale' THEN amount END), 0) AS totalReceived,
    COALESCE(SUM(CASE WHEN type = 'purchase' THEN amount END), 0) AS totalSpent,
    COALESCE(SUM(CASE WHEN type = 'capital' THEN amount END), 0) AS totalCapital,
    (SELECT COUNT(*) FROM items
      WHERE user_id = @userId
        AND track_stock = 1
        AND low_stock_threshold > 0
        AND stock <= low_stock_threshold) AS lowStockCount
  FROM transactions
  WHERE user_id = @userId
`;

// "Today" is the owner's calendar day (`asOf`, sent by the phone). The
// server's local day is only the fallback for a caller that sends none.
export function moneySummary(
  db: Database.Database,
  userId: number,
  asOf: string = localDateString(),
): MoneySummary {
  const row = db.prepare(SUMMARY_SQL).get({ userId, asOf }) as unknown as SummaryRow;
  const todayReceived = Number(row.todayReceived);
  const todaySpent = Number(row.todaySpent);
  const totalReceived = Number(row.totalReceived);
  const totalSpent = Number(row.totalSpent);

  return {
    todayReceived,
    todaySpent,
    todayNet: todayReceived - todaySpent,
    totalReceived,
    totalSpent,
    totalNet: totalReceived - totalSpent,
    totalCapital: Number(row.totalCapital),
    lowStockCount: Number(row.lowStockCount),
  };
}
