import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { runMigrations } from '../migrate.js';
import { MIGRATIONS } from './index.js';
import { baseline } from './0001_baseline.js';
import { integerMoney } from './0002_integer_money.js';
import { languageWes } from './0003_language_wes.js';
import { dropPasswordFingerprints } from './0004_drop_password_fingerprints.js';
import { resetCodes } from './0005_reset_codes.js';
import { lowStockAlert } from './0006_low_stock_alert.js';
import { announcements } from './0007_announcements.js';
import { pushNotifications } from './0008_push_notifications.js';
import { inactivityNotifications } from './0009_inactivity_notifications.js';

const BEFORE = [
  baseline,
  integerMoney,
  languageWes,
  dropPasswordFingerprints,
  resetCodes,
  lowStockAlert,
  announcements,
  pushNotifications,
  inactivityNotifications,
];
const ID = 'a'.repeat(32);
const HASH = 'b'.repeat(64);

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

function columns(db: Database.Database): string[] {
  return (db.pragma('table_info(sessions)') as { name: string }[]).map(c => c.name);
}

function seedUser(db: Database.Database, id = 1, email = 'a@example.com'): void {
  db.prepare(
    "INSERT INTO users (id, company_name, email, password_hash) VALUES (?, 'A', ?, 'h')",
  ).run(id, email);
}

test('0010 adds the sessions table without touching accounts', () => {
  const db = memory();
  runMigrations(db, BEFORE);
  db.exec(`
    INSERT INTO users (id, company_name, email, password_hash) VALUES (1, 'A', 'a@example.com', 'h1');
  `);

  runMigrations(db, MIGRATIONS);

  assert.deepEqual(columns(db), [
    'id',
    'user_id',
    'refresh_hash',
    'created_at',
    'last_used_at',
    'expires_at',
    'revoked_at',
  ]);
  assert.deepEqual(db.prepare('SELECT id, password_hash FROM users').all(), [
    { id: 1, password_hash: 'h1' },
  ]);
  assert.deepEqual(
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'sessions' AND name NOT LIKE 'sqlite_autoindex%'",
      )
      .all(),
    [{ name: 'idx_sessions_user' }],
  );
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('0010: a session needs its account and well-formed values', () => {
  const db = memory();
  runMigrations(db, MIGRATIONS);
  seedUser(db);

  const insert = db.prepare(
    'INSERT INTO sessions (id, user_id, refresh_hash, created_at, last_used_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  insert.run(ID, 1, HASH, 1, 1, 2);
  assert.deepEqual(db.prepare('SELECT revoked_at FROM sessions').all(), [{ revoked_at: null }]);
  assert.throws(() => insert.run('short', 1, HASH, 1, 1, 2), /CHECK constraint/);
  assert.throws(() => insert.run('c'.repeat(32), 1, 'bare-secret', 1, 1, 2), /CHECK constraint/);
  assert.throws(() => insert.run('d'.repeat(32), 99, HASH, 1, 1, 2), /FOREIGN KEY/);

  db.prepare('DELETE FROM users WHERE id = 1').run();
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n, 0);
});

test('0010 on a fresh database gives the same schema as an upgraded one', () => {
  const fresh = memory();
  runMigrations(fresh, MIGRATIONS);
  assert.ok(
    (fresh.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).some(
      row => row.version === 10,
    ),
  );

  const upgraded = memory();
  runMigrations(upgraded, BEFORE);
  runMigrations(upgraded, MIGRATIONS);
  assert.deepEqual(schema(upgraded), schema(fresh));
});
