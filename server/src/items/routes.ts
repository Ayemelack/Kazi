import { Router } from 'express';
import type Database from 'better-sqlite3';
import { requireAuth } from '../middleware/auth.js';
import { runIdempotent } from '../idempotency.js';
import {
  createItem,
  deleteItem,
  getItem,
  listItems,
  listStockMovements,
  stockIn,
  stockOut,
  updateItem,
} from './service.js';
import {
  createItemSchema,
  itemIdSchema,
  stockMovementSchema,
  updateItemSchema,
  validate,
} from './validation.js';

export function createItemsRouter(db: Database.Database): Router {
  const router = Router();

  router.use(requireAuth(db));

  router.get('/', (req, res, next) => {
    try {
      res.status(200).json({ items: listItems(db, req.user?.id ?? 0) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', (req, res, next) => {
    try {
      const input = validate(createItemSchema, req.body);
      const userId = req.user?.id ?? 0;
      const { value: item, replayed } = runIdempotent(
        db,
        userId,
        input.clientOpId,
        'item_create',
        () => createItem(db, userId, input),
      );
      res.status(replayed ? 200 : 201).json({ item });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', (req, res, next) => {
    try {
      const itemId = validate(itemIdSchema, req.params.id);
      const item = getItem(db, req.user?.id ?? 0, itemId);
      res.status(200).json({ item });
    } catch (err) {
      next(err);
    }
  });

  router.put('/:id', (req, res, next) => {
    try {
      const itemId = validate(itemIdSchema, req.params.id);
      const item = updateItem(db, req.user?.id ?? 0, itemId, validate(updateItemSchema, req.body));
      res.status(200).json({ item });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', (req, res, next) => {
    try {
      const itemId = validate(itemIdSchema, req.params.id);
      deleteItem(db, req.user?.id ?? 0, itemId);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/stock-in', (req, res, next) => {
    try {
      const itemId = validate(itemIdSchema, req.params.id);
      const input = validate(stockMovementSchema, req.body);
      const userId = req.user?.id ?? 0;
      const { value: result } = runIdempotent(
        db,
        userId,
        input.clientOpId,
        'item_stock_in',
        () => stockIn(db, userId, itemId, input),
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/stock-out', (req, res, next) => {
    try {
      const itemId = validate(itemIdSchema, req.params.id);
      const input = validate(stockMovementSchema, req.body);
      const userId = req.user?.id ?? 0;
      const { value: result } = runIdempotent(
        db,
        userId,
        input.clientOpId,
        'item_stock_out',
        () => stockOut(db, userId, itemId, input),
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id/movements', (req, res, next) => {
    try {
      const itemId = validate(itemIdSchema, req.params.id);
      const movements = listStockMovements(db, req.user?.id ?? 0, itemId);
      res.status(200).json({ movements });
    } catch (err) {
      next(err);
    }
  });

  return router;
}