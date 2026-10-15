import type Database from 'better-sqlite3';
import { AppError } from '../errors.js';
import { deleteActivityRefs, logActivity } from '../activity/service.js';
import type {
  CreateItemInput,
  StockMovementInput,
  UpdateItemInput,
} from './validation.js';

export type ItemType = 'product' | 'service';

export interface Item {
  id: number;
  name: string;
  type: ItemType;
  price: number;
  notes?: string;
  image?: string;
  stock: number;
  trackStock: boolean;
  lowStockThreshold: number;
  lowStock: boolean;
  createdAt: string;
}

export type StockDirection = 'in' | 'out';

export interface StockMovement {
  id: number;
  itemId: number;
  direction: StockDirection;
  quantity: number;
  newQuantity: number;
  reason?: string;
  createdAt: string;
}

interface ItemRow {
  id: number;
  user_id: number;
  name: string;
  type: ItemType;
  price: number;
  notes: string | null;
  image: string | null;
  stock: number;
  track_stock: number;
  low_stock_threshold: number;
  created_at: string;
}

interface MovementRow {
  id: number;
  item_id: number;
  direction: StockDirection;
  quantity: number;
  new_quantity: number;
  reason: string | null;
  created_at: string;
}

function toItem(row: ItemRow): Item {
  const trackStock = row.track_stock === 1;
  const lowStockThreshold = row.low_stock_threshold;
  const lowStock = trackStock && lowStockThreshold > 0 && row.stock <= lowStockThreshold;
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    price: row.price,
    notes: row.notes ?? undefined,
    image: row.image ?? undefined,
    stock: row.stock,
    trackStock,
    lowStockThreshold,
    lowStock,
    createdAt: row.created_at,
  };
}

function toMovement(row: MovementRow): StockMovement {
  return {
    id: row.id,
    itemId: row.item_id,
    direction: row.direction,
    quantity: row.quantity,
    newQuantity: row.new_quantity,
    reason: row.reason ?? undefined,
    createdAt: row.created_at,
  };
}

function requireOwnedItem(
  db: Database.Database,
  userId: number,
  itemId: number,
): ItemRow {
  const row = db
    .prepare('SELECT * FROM items WHERE id = ? AND user_id = ?')
    .get(itemId, userId) as unknown as ItemRow | undefined;

  if (!row) {
    throw new AppError(404, 'NOT_FOUND', 'This item does not exist.');
  }
  return row;
}

export function listItems(db: Database.Database, userId: number): Item[] {
  const rows = db
    .prepare('SELECT * FROM items WHERE user_id = ? ORDER BY created_at DESC, id DESC')
    .all(userId) as unknown as ItemRow[];
  return rows.map(toItem);
}

export function getItem(
  db: Database.Database,
  userId: number,
  itemId: number,
): Item {
  return toItem(requireOwnedItem(db, userId, itemId));
}

export function deleteItem(
  db: Database.Database,
  userId: number,
  itemId: number,
): void {
  requireOwnedItem(db, userId, itemId);
  db.transaction(() => {
    db.prepare('DELETE FROM items WHERE id = ? AND user_id = ?').run(itemId, userId);
    // The product's own history entries go with it; money entries created from
    // sales and purchases of it keep their own ref and stay.
    deleteActivityRefs(db, userId, { type: 'item', id: itemId });
  })();
}

export function createItem(
  db: Database.Database,
  userId: number,
  input: CreateItemInput,
): Item {
  const trackStock = input.trackStock ?? false;
  const threshold = trackStock ? (input.lowStockThreshold ?? 0) : 0;

  const id = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO items
           (user_id, name, type, price, notes, image, stock, track_stock, low_stock_threshold)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(
        userId,
        input.name,
        input.type,
        input.price,
        input.notes ?? null,
        input.image ?? null,
        trackStock ? 1 : 0,
        threshold,
      );

    const itemId = Number(result.lastInsertRowid);

    logActivity(db, userId, {
      type: 'product_added',
      title: input.name,
      ref: { type: 'item', id: itemId },
    });

    return itemId;
  })();

  const row = db
    .prepare('SELECT * FROM items WHERE id = ?')
    .get(id) as unknown as ItemRow;

  return toItem(row);
}

export function updateItem(
  db: Database.Database,
  userId: number,
  itemId: number,
  input: UpdateItemInput,
): Item {
  requireOwnedItem(db, userId, itemId);

  const trackStock = input.trackStock ?? false;
  const threshold = trackStock ? (input.lowStockThreshold ?? 0) : 0;

  db.transaction(() => {
    db.prepare(
      `UPDATE items
       SET name = ?, type = ?, price = ?, notes = ?, image = ?, track_stock = ?, low_stock_threshold = ?,
           updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`,
    ).run(
      input.name,
      input.type,
      input.price,
      input.notes ?? null,
      input.image ?? null,
      trackStock ? 1 : 0,
      threshold,
      itemId,
      userId,
    );

    logActivity(db, userId, {
      type: 'product_updated',
      title: input.name,
      ref: { type: 'item', id: itemId },
    });
  })();

  return toItem(requireOwnedItem(db, userId, itemId));
}

export function stockIn(
  db: Database.Database,
  userId: number,
  itemId: number,
  input: StockMovementInput,
): { item: Item; movement: StockMovement } {
  const row = requireOwnedItem(db, userId, itemId);

  const movement = db.transaction(() => {
    const newQuantity = row.stock + input.quantity;
    db.prepare(
      `UPDATE items SET stock = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
    ).run(newQuantity, itemId, userId);
    const result = db
      .prepare(
        `INSERT INTO stock_movements (item_id, user_id, direction, quantity, new_quantity, reason)
         VALUES (?, ?, 'in', ?, ?, ?)`,
      )
      .run(itemId, userId, input.quantity, newQuantity, input.reason ?? null);
    return { newQuantity, movementId: result.lastInsertRowid };
  })();

  const movementRow = db
    .prepare('SELECT * FROM stock_movements WHERE id = ?')
    .get(movement.movementId) as unknown as MovementRow;

  return { item: toItem(requireOwnedItem(db, userId, itemId)), movement: toMovement(movementRow) };
}

export interface StockOutOptions {
  // Take the full quantity even if stock goes below zero. Used when a
  // purchase is deleted (decision D5: stock may be negative); session 11
  // (KZ-23) decides the rule for sales and manual stock-outs.
  allowNegative?: boolean;
}

export function stockOut(
  db: Database.Database,
  userId: number,
  itemId: number,
  input: StockMovementInput,
  options: StockOutOptions = {},
): { item: Item; movement: StockMovement } {
  const row = requireOwnedItem(db, userId, itemId);

  if (!options.allowNegative && row.stock - input.quantity < 0) {
    throw new AppError(
      400,
      'INSUFFICIENT_STOCK',
      'Not enough items in stock. Try a smaller quantity.',
    );
  }

  const movement = db.transaction(() => {
    const newQuantity = row.stock - input.quantity;
    db.prepare(
      `UPDATE items SET stock = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
    ).run(newQuantity, itemId, userId);
    const result = db
      .prepare(
        `INSERT INTO stock_movements (item_id, user_id, direction, quantity, new_quantity, reason)
         VALUES (?, ?, 'out', ?, ?, ?)`,
      )
      .run(itemId, userId, input.quantity, newQuantity, input.reason ?? null);
    return { newQuantity, movementId: result.lastInsertRowid };
  })();

  const movementRow = db
    .prepare('SELECT * FROM stock_movements WHERE id = ?')
    .get(movement.movementId) as unknown as MovementRow;

  return { item: toItem(requireOwnedItem(db, userId, itemId)), movement: toMovement(movementRow) };
}

export function listStockMovements(
  db: Database.Database,
  userId: number,
  itemId: number,
  limit = 50,
): StockMovement[] {
  requireOwnedItem(db, userId, itemId);

  const rows = db
    .prepare(
      `SELECT * FROM stock_movements
       WHERE item_id = ? AND user_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .all(itemId, userId, limit) as unknown as MovementRow[];

  return rows.map(toMovement);
}