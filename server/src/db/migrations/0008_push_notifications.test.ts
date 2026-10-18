import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { runMigrations } from '../migrate.js';
import { legacyMigrate } from '../legacyFixtures.js';
import { MIGRATIONS } from './index.js';

const BEFORE = MIGRATIONS.filter(m => m.version < 8);

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

test('0008 adds push_notifications (on for existing accounts) and the history table', () => {
  const db = memory();
  runMigrations(db, BEFORE);
  db.exec(`
    INSERT INTO users (id, company_name, email, password_hash) VALUES (1, 'A', 'a@example.com', 'h1');
    INSERT INTO items (id, user_id, name, type, price) VALUES (1, 1, 'Rice', 'product', 500);
  `);

  runMigrations(db, MIGRATIONS);

  assert.deepEqual(
    db.prepare('SELECT id, push_notifications FROM users').all(),
    [{ id: 1, push_notifications: 1 }],
    'existing accounts keep their pushes',
  );
  const tables = schema(db).filter(line => line.startsWith('table '));
  assert.ok(tables.some(line => line.startsWith('table user_notifications ')));
  const columns = (db.pragma('table_info(user_notifications)') as { name: string }[]).map(c => c.name);
  assert.deepEqual(columns, [
    'id',
    'user_id',
    'type',
    'item_id',
    'title',
    'body',
    'created_at',
    'read_at',
  ]);
  assert.ok(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_user_notifications_user'")
      .get(),
    'history reads are indexed by user',
  );
  assert.deepEqual(db.pragma('foreign_key_check'), []);

  // A history row belongs to its account and disappears with it.
  db.prepare(
    "INSERT INTO user_notifications (user_id, type, title, body) VALUES (1, 'low_stock', 'Low stock alert', 'Rice: only 3 left.')",
  ).run();
  db.prepare('DELETE FROM users WHERE id = 1').run();
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS n FROM user_notifications').get() as { n: number }).n,
    0,
  );
});

test('0008 on a fresh database gives the same schema as an upgraded one', () => {
  const fresh = memory();
  runMigrations(fresh, MIGRATIONS);
  const upgraded = memory();
  runMigrations(upgraded, BEFORE);
  runMigrations(upgraded, MIGRATIONS);
  assert.deepEqual(schema(upgraded), schema(fresh));
  const column = (
    fresh.pragma('table_info(users)') as { name: string; dflt_value: string | null }[]
  ).find(field => field.name === 'push_notifications');
  assert.equal(column?.dflt_value, '1', 'accounts created after the migration still start on');
});

test('a database created by the pre-framework boot code gains the preference and the table', () => {
  const legacy = memory();
  legacyMigrate(legacy);
  legacy.exec("INSERT INTO users (company_name, email, password_hash) VALUES ('Shop', 'b@example.com', 'hash')");

  runMigrations(legacy, MIGRATIONS);

  const fresh = memory();
  runMigrations(fresh, MIGRATIONS);
  assert.deepEqual(schema(legacy), schema(fresh));
  assert.deepEqual(legacy.prepare('SELECT push_notifications FROM users').all(), [
    { push_notifications: 1 },
  ]);
  assert.deepEqual(legacy.pragma('foreign_key_check'), []);
});
