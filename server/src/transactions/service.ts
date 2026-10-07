import type Database from 'better-sqlite3';
import { AppError } from '../errors.js';
import { deleteActivityRefs, logActivity } from '../activity/service.js';
import { stockIn, stockOut } from '../items/service.js';
import type { ItemType } from '../items/validation.js';
import type { CreateTransactionInput } from './validation.js';

export type TransactionType = 'sale' | 'purchase' | 'capital';

export interface TransactionItem {
  id: number;
  name: string;
  type: ItemType;
}

export interface Transaction {
  id: number;
  type: TransactionType;
  amount: number;
  description?: string;
  item?: TransactionItem;
  quantity?: number;
  date: string;
  createdAt: string;
}

interface TransactionRow {
  id: number;
  user_id: number;
  type: TransactionType;
  amount: number;
  item_id: number | null;
  quantity: number | null;
  description: string | null;
  date: string;
  created_at: string;
  item_name: string | null;
  item_type: ItemType | null;
}

function toTransaction(row: TransactionRow): Transaction {
  const transaction: Transaction = {
    id: row.id,
    type: row.type,
    amount: row.amount,
    description: row.description ?? undefined,
    date: row.date,
    createdAt: row.created_at,
  };
  if (row.item_id !== null && row.item_name !== null && row.item_type !== null) {
    transaction.item = { id: row.item_id, name: row.item_name, type: row.item_type };
  }
  if (row.quantity !== null) {
    transaction.quantity = row.quantity;
  }
  return transaction;
}

const JOIN_QUERY = `
  SELECT t.*, i.name AS item_name, i.type AS item_type
  FROM transactions t
  LEFT JOIN items i ON i.id = t.item_id
`;

function requireOwnedTransaction(
  db: Database.Database,
  userId: number,
  transactionId: number,
): TransactionRow {
  const row = db
    .prepare(`${JOIN_QUERY} WHERE t.id = ? AND t.user_id = ?`)
    .get(transactionId, userId) as unknown as TransactionRow | undefined;

  if (!row) {
    throw new AppError(404, 'NOT_FOUND', 'This transaction does not exist.');
  }
  return row;
}

export function listTransactions(
  db: Database.Database,
  userId: number,
  limit = 100,
): Transaction[] {
  const rows = db
    .prepare(`${JOIN_QUERY} WHERE t.user_id = ? ORDER BY t.date DESC, t.id DESC LIMIT ?`)
    .all(userId, limit) as unknown as TransactionRow[];
  return rows.map(toTransaction);
}

export function getTransaction(
  db: Database.Database,
  userId: number,
  transactionId: number,
): Transaction {
  return toTransaction(requireOwnedTransaction(db, userId, transactionId));
}

export function createTransaction(
  db: Database.Database,
  userId: number,
  input: CreateTransactionInput,
): Transaction {
  const { type, amount, description, date, itemId, quantity } = input;

  if (quantity !== undefined && itemId === undefined) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Quantity requires a selected item.');
  }

  if (type === 'capital' && itemId !== undefined) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Adding money does not link to an item.',
    );
  }

  const created = db.transaction(() => {
    let itemRow: { id: number; name: string; track_stock: number } | undefined;
    if (itemId !== undefined) {
      itemRow = db
        .prepare('SELECT id, name, track_stock FROM items WHERE id = ? AND user_id = ?')
        .get(itemId, userId) as unknown as
        | { id: number; name: string; track_stock: number }
        | undefined;
      if (!itemRow) {
        throw new AppError(404, 'NOT_FOUND', 'This item does not exist.');
      }
    }

    const tracked = itemRow?.track_stock === 1;
    const quantityApplied = itemId !== undefined ? (quantity ?? 1) : null;

    if (itemRow && tracked && quantityApplied !== null) {
      if (type === 'sale') {
        stockOut(db, userId, itemRow.id, { quantity: quantityApplied, reason: 'Sale' });
      } else {
        stockIn(db, userId, itemRow.id, { quantity: quantityApplied, reason: 'Purchase' });
      }
    }

    const result = db
      .prepare(
        `INSERT INTO transactions (user_id, type, amount, item_id, quantity, description, date)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(userId, type, amount, itemId ?? null, quantityApplied, description ?? null, date);

    const transactionId = Number(result.lastInsertRowid);
    const activityType =
      type === 'sale' ? 'sale' : type === 'purchase' ? 'spend' : 'capital';

    logActivity(db, userId, {
      type: activityType,
      title: description?.trim() || itemRow?.name || undefined,
      amount,
      quantity: quantityApplied ?? undefined,
      eventDate: date,
      ref: { type: 'transaction', id: transactionId },
    });

    const row = db
      .prepare(`${JOIN_QUERY} WHERE t.id = ?`)
      .get(transactionId) as unknown as TransactionRow;
    return row;
  })();

  return toTransaction(created);
}

export function deleteTransaction(
  db: Database.Database,
  userId: number,
  transactionId: number,
): void {
  const transaction = requireOwnedTransaction(db, userId, transactionId);

  db.transaction(() => {
    if (transaction.item_id !== null && transaction.quantity !== null) {
      const itemRow = db
        .prepare('SELECT id, stock, track_stock FROM items WHERE id = ? AND user_id = ?')
        .get(transaction.item_id, userId) as unknown as
        | { id: number; stock: number; track_stock: number }
        | undefined;

      if (itemRow && itemRow.track_stock === 1) {
        if (transaction.type === 'sale') {
          stockIn(db, userId, itemRow.id, {
            quantity: transaction.quantity,
            reason: 'Sale removed',
          });
        } else {
          const quantity = Math.min(transaction.quantity, itemRow.stock);
          if (quantity > 0) {
            stockOut(db, userId, itemRow.id, {
              quantity,
              reason: 'Purchase removed',
            });
          }
        }
      }
    }

    db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(
      transactionId,
      userId,
    );

    // Drop the history entry in the same transaction, otherwise What Happened
    // keeps showing a record that no longer exists.
    deleteActivityRefs(db, userId, { type: 'transaction', id: transactionId });
  })();
}