import type Database from 'better-sqlite3';
import { AppError } from '../errors.js';
import { deleteActivityRefs, logActivity } from '../activity/service.js';
import { localDateString } from '../validation/date.js';
import type { CreateDebtInput } from './validation.js';

export type DebtStatus = 'open' | 'paid';

export interface Debt {
  id: number;
  name: string;
  amount: number;
  note?: string;
  date: string;
  status: DebtStatus;
  paidAt?: string;
  createdAt: string;
}

interface DebtRow {
  id: number;
  user_id: number;
  name: string;
  amount: number;
  note: string | null;
  date: string;
  status: DebtStatus;
  paid_at: string | null;
  created_at: string;
}

function toDebt(row: DebtRow): Debt {
  return {
    id: row.id,
    name: row.name,
    amount: row.amount,
    note: row.note ?? undefined,
    date: row.date,
    status: row.status,
    paidAt: row.paid_at ?? undefined,
    createdAt: row.created_at,
  };
}

function requireOwnedDebt(
  db: Database.Database,
  userId: number,
  debtId: number,
): DebtRow {
  const row = db
    .prepare('SELECT * FROM debts WHERE id = ? AND user_id = ?')
    .get(debtId, userId) as unknown as DebtRow | undefined;

  if (!row) {
    throw new AppError(404, 'NOT_FOUND', 'This debt does not exist.');
  }
  return row;
}

export function listDebts(
  db: Database.Database,
  userId: number,
  status?: DebtStatus,
): Debt[] {
  let query = 'SELECT * FROM debts WHERE user_id = ?';
  const params: (number | string)[] = [userId];
  if (status) {
    query += ' AND status = ? ORDER BY date DESC, id DESC';
    params.push(status);
  } else {
    query += ` ORDER BY CASE WHEN status = 'open' THEN 0 ELSE 1 END, date DESC, id DESC`;
  }
  const rows = db.prepare(query).all(...params) as unknown as DebtRow[];
  return rows.map(toDebt);
}

export function getDebt(
  db: Database.Database,
  userId: number,
  debtId: number,
): Debt {
  return toDebt(requireOwnedDebt(db, userId, debtId));
}

export function createDebt(
  db: Database.Database,
  userId: number,
  input: CreateDebtInput,
): Debt {
  const created = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO debts (user_id, name, amount, note, date)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(userId, input.name, input.amount, input.note ?? null, input.date);

    const debtId = Number(result.lastInsertRowid);
    const row = db
      .prepare('SELECT * FROM debts WHERE id = ?')
      .get(debtId) as unknown as DebtRow;

    logActivity(db, userId, {
      type: 'debt_added',
      title: input.name,
      amount: input.amount,
      eventDate: input.date,
      ref: { type: 'debt', id: debtId },
    });

    return row;
  })();

  return toDebt(created);
}

export function payDebt(
  db: Database.Database,
  userId: number,
  debtId: number,
  date?: string,
): Debt {
  const updated = db.transaction(() => {
    const row = requireOwnedDebt(db, userId, debtId);
    if (row.status === 'paid') {
      throw new AppError(400, 'ALREADY_PAID', 'This debt is already paid.');
    }

    // paid_at is the exact instant, in UTC and ISO-8601 so it renders as the
    // correct local time in the app. The business date is whichever day the
    // owner says the money changed hands.
    db.prepare(
      `UPDATE debts SET status = 'paid', paid_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
    ).run(debtId, userId);

    logActivity(db, userId, {
      type: 'debt_paid',
      title: row.name,
      amount: row.amount,
      eventDate: date ?? localDateString(),
      ref: { type: 'debt', id: debtId },
    });

    return requireOwnedDebt(db, userId, debtId);
  })();

  return toDebt(updated);
}

export function deleteDebt(
  db: Database.Database,
  userId: number,
  debtId: number,
): void {
  requireOwnedDebt(db, userId, debtId);
  db.transaction(() => {
    db.prepare('DELETE FROM debts WHERE id = ? AND user_id = ?').run(debtId, userId);
    // History must not keep a record of a debt that is gone.
    deleteActivityRefs(db, userId, { type: 'debt', id: debtId });
  })();
}