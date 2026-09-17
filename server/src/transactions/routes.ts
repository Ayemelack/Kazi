import { Router } from 'express';
import type Database from 'better-sqlite3';
import { requireAuth } from '../middleware/auth.js';
import { runIdempotent } from '../idempotency.js';
import {
  createTransaction,
  deleteTransaction,
  getTransaction,
  listTransactions,
} from './service.js';
import {
  createTransactionSchema,
  transactionIdSchema,
  validate,
} from './validation.js';

export function createTransactionsRouter(db: Database.Database): Router {
  const router = Router();

  router.use(requireAuth(db));

  router.get('/', (req, res, next) => {
    try {
      const transactions = listTransactions(db, req.user?.id ?? 0);
      res.status(200).json({ transactions });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', (req, res, next) => {
    try {
      const input = validate(createTransactionSchema, req.body);
      const userId = req.user?.id ?? 0;
      const { value: transaction, replayed } = runIdempotent(
        db,
        userId,
        input.clientOpId,
        'transaction_create',
        () => createTransaction(db, userId, input),
      );
      res.status(replayed ? 200 : 201).json({ transaction });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', (req, res, next) => {
    try {
      const transactionId = validate(transactionIdSchema, req.params.id);
      const transaction = getTransaction(db, req.user?.id ?? 0, transactionId);
      res.status(200).json({ transaction });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', (req, res, next) => {
    try {
      const transactionId = validate(transactionIdSchema, req.params.id);
      deleteTransaction(db, req.user?.id ?? 0, transactionId);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}