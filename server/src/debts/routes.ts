import { Router } from 'express';
import type Database from 'better-sqlite3';
import { requireAuth } from '../middleware/auth.js';
import { runIdempotent } from '../idempotency.js';
import {
  createDebt,
  deleteDebt,
  getDebt,
  listDebts,
  payDebt,
} from './service.js';
import {
  createDebtSchema,
  debtIdSchema,
  listDebtsQuerySchema,
  payDebtSchema,
  validate,
} from './validation.js';

export function createDebtsRouter(db: Database.Database): Router {
  const router = Router();

  router.use(requireAuth(db));

  router.get('/', (req, res, next) => {
    try {
      const query = validate(listDebtsQuerySchema, req.query);
      res.status(200).json({ debts: listDebts(db, req.user?.id ?? 0, query.status) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', (req, res, next) => {
    try {
      const input = validate(createDebtSchema, req.body);
      const userId = req.user?.id ?? 0;
      const { value: debt, replayed } = runIdempotent(
        db,
        userId,
        input.clientOpId,
        'debt_create',
        () => createDebt(db, userId, input),
      );
      res.status(replayed ? 200 : 201).json({ debt });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', (req, res, next) => {
    try {
      const debtId = validate(debtIdSchema, req.params.id);
      res.status(200).json({ debt: getDebt(db, req.user?.id ?? 0, debtId) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/pay', (req, res, next) => {
    try {
      const debtId = validate(debtIdSchema, req.params.id);
      const userId = req.user?.id ?? 0;
      const input = validate(payDebtSchema, req.body);
      const { value: debt } = runIdempotent(
        db,
        userId,
        input.clientOpId,
        'debt_pay',
        () => payDebt(db, userId, debtId, input.date),
      );
      res.status(200).json({ debt });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', (req, res, next) => {
    try {
      const debtId = validate(debtIdSchema, req.params.id);
      deleteDebt(db, req.user?.id ?? 0, debtId);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}