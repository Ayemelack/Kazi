import type Database from 'better-sqlite3';

export interface MoneySummary {
  todayReceived: number;
  todaySpent: number;
  todayNet: number;
  totalReceived: number;
  totalSpent: number;
  totalNet: number;
  totalCapital: number;
}

interface SumRow {
  total: number | null;
}

function sumFor(
  db: Database.Database,
  userId: number,
  type: 'sale' | 'purchase' | 'capital',
  whereDate?: string,
): number {
  let sql = 'SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE user_id = ? AND type = ?';
  const params: (number | string)[] = [userId, type];
  if (whereDate) {
    sql += ' AND date = ?';
    params.push(whereDate);
  }
  const row = db.prepare(sql).get(...params) as unknown as SumRow;
  return Number(row.total ?? 0);
}

export function moneySummary(db: Database.Database, userId: number): MoneySummary {
  const today = new Date();
  const todayDate = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-');

  const todayReceived = sumFor(db, userId, 'sale', todayDate);
  const todaySpent = sumFor(db, userId, 'purchase', todayDate);
  const totalReceived = sumFor(db, userId, 'sale');
  const totalSpent = sumFor(db, userId, 'purchase');
  const totalCapital = sumFor(db, userId, 'capital');

  return {
    todayReceived,
    todaySpent,
    todayNet: todayReceived - todaySpent,
    totalReceived,
    totalSpent,
    totalNet: totalReceived - totalSpent,
    totalCapital,
  };
}