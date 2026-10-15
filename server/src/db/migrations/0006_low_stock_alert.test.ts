import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { runMigrations } from '../migrate.js';
import { MIGRATIONS } from './index.js';

const BEFORE = MIGRATIONS.filter(m => m.version < 6);

function memory(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}

function schema(db: Database.Database): string[] {
  return (
    db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY type, name').all() as {
      type: string;
      name: string;
      sql: string | null;
    }[]
  )
    .filter(row => row.name !== 'schema_migrations')
    .map(row => `${row.type} ${row.name} ${row.sql ?? ''}`);
}

test('0006 adds last_low_stock_alert_at to items, NULL for existing items', () => {
  const db = memory();
  runMigrations(db, BEFORE);
  db.exec(`
    INSERT INTO users (id, company_name, email, password_hash) VALUES (1, 'A', 'a@example.com', 'h1');
    INSERT INTO items (id, user_id, name, type, price, stock, track_stock, low_stock_threshold)
      VALUES (1, 1, 'Rice', 'product', 500, 3, 1, 5);
  `);

  runMigrations(db, MIGRATIONS);

  assert.deepEqual(
    db.prepare('SELECT id, stock, low_stock_threshold, last_low_stock_alert_at FROM items').all(),
    [{ id: 1, stock: 3, low_stock_threshold: 5, last_low_stock_alert_at: null }],
  );
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('0006 on a fresh database gives the same schema as an upgraded one', () => {
  const fresh = memory();
  runMigrations(fresh, MIGRATIONS);
  const upgraded = memory();
  runMigrations(upgraded, BEFORE);
  runMigrations(upgraded, MIGRATIONS);
  assert.deepEqual(schema(upgraded), schema(fresh));
  assert.ok(schema(fresh).some(line => line.startsWith('table items ') && line.includes('last_low_stock_alert_at INTEGER')));
});
