import type Database from 'better-sqlite3';
import { AppError } from './errors.js';

// Idempotency ledger: lets the backend recognize a repeated submission of the
// same offline operation (same user + client operation id) and answer it with
// the stored result instead of applying the operation a second time. This is
// the server-side half of offline-first duplicate prevention.
//
// Responses are stored as compact JSON alongside a loose reference so the
// ledger stays small and does not depend on any single domain table.

interface OpRow {
  op_type: string;
  response: string;
}

interface IdempotentResult<T> {
  value: T;
  replayed: boolean;
}

export function runIdempotent<T>(
  db: Database.Database,
  userId: number,
  clientOpId: string | undefined,
  opType: string,
  run: () => T,
): IdempotentResult<T> {
  if (!clientOpId) {
    // Callers that do not participate in offline sync (or legacy requests)
    // simply run once with no ledger write.
    return { value: run(), replayed: false };
  }

  const existing = db
    .prepare(
      'SELECT op_type, response FROM client_ops WHERE user_id = ? AND client_op_id = ?',
    )
    .get(userId, clientOpId) as unknown as OpRow | undefined;

  if (existing) {
    // A client operation id must identify exactly one logical operation. If the
    // same id is presented for a different operation type we refuse it instead
    // of replaying an unrelated stored response, which would silently drop the
    // new operation and hand the caller the wrong record back.
    if (existing.op_type !== opType) {
      throw new AppError(
        409,
        'IDEMPOTENCY_CONFLICT',
        'This operation id was already used for a different action.',
      );
    }
    return { value: JSON.parse(existing.response) as T, replayed: true };
  }

  const value = db.transaction(() => {
    const result = run();
    db.prepare(
      `INSERT INTO client_ops (user_id, client_op_id, op_type, response)
       VALUES (?, ?, ?, ?)`,
    ).run(userId, clientOpId, opType, JSON.stringify(result));
    return result;
  })();

  return { value, replayed: false };
}