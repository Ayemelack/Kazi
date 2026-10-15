import type { Migration } from '../migrate.js';

// KZ-03 (decision D6): when the API last sent a low-stock push for an item,
// in epoch milliseconds, or NULL if it never has. A crossing sends at most one
// alert per item per 12 hours (notifications/lowStock.ts). A plain added
// column: existing items start with NULL, so their next crossing alerts.
export const lowStockAlert: Migration = {
  version: 6,
  name: 'low_stock_alert',
  up(db) {
    db.exec('ALTER TABLE items ADD COLUMN last_low_stock_alert_at INTEGER');
  },
};
