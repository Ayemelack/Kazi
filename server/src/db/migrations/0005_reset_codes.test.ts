import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { runMigrations } from '../migrate.js';
import { MIGRATIONS } from './index.js';
import { baseline } from './0001_baseline.js';
import { integerMoney } from './0002_integer_money.js';
import { languageWes } from './0003_language_wes.js';
import { dropPasswordFingerprints } from './0004_drop_password_fingerprints.js';

const BEFORE = [baseline, integerMoney, languageWes, dropPasswordFingerprints];
const HASH = 'a'.repeat(64);

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
  return (db.pragma('table_info(password_resets)') as { name: string }[]).map(c => c.name);
}

test('0005 replaces the token table with the code table and keeps the accounts', () => {
  const db = memory();
  runMigrations(db, BEFORE);
  db.exec(`
    INSERT INTO users (id, company_name, email, password_hash) VALUES
      (1, 'A', 'a@example.com', 'h1'),
      (2, 'B', 'b@example.com', 'h2');
    INSERT INTO password_resets (token, user_id, expires_at, used) VALUES
      ('t1', 1, 9999999999999, 0),
      ('t2', 2, 1, 1);
  `);
  assert.deepEqual(columns(db), ['token', 'user_id', 'expires_at', 'used']);

  runMigrations(db, MIGRATIONS);

  assert.deepEqual(columns(db), ['id', 'user_id', 'code_hash', 'expires_at', 'attempts', 'used', 'created_at']);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM password_resets').get() as { n: number }).n, 0);
  assert.deepEqual(db.prepare('SELECT id, password_hash FROM users ORDER BY id').all(), [
    { id: 1, password_hash: 'h1' },
    { id: 2, password_hash: 'h2' },
  ]);
  assert.deepEqual(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'password_resets'").all(),
    [{ name: 'idx_password_resets_user' }],
  );
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('0005: codes default to 0 attempts, follow their account on delete, and refuse bad values', () => {
  const db = memory();
  runMigrations(db, MIGRATIONS);
  db.exec(`
    INSERT INTO users (id, company_name, email, password_hash) VALUES (1, 'A', 'a@example.com', 'h1');
    INSERT INTO password_resets (user_id, code_hash, expires_at) VALUES (1, '${HASH}', 1);
    INSERT INTO password_resets (user_id, code_hash, expires_at) VALUES (1, '${HASH}', 2);
  `);
  assert.deepEqual(db.prepare('SELECT attempts, used FROM password_resets').all(), [
    { attempts: 0, used: 0 },
    { attempts: 0, used: 0 },
  ]);
  const insert = db.prepare('INSERT INTO password_resets (user_id, code_hash, expires_at, attempts, used) VALUES (?, ?, ?, ?, ?)');
  assert.throws(() => insert.run(1, '123456', 1, 0, 0), /CHECK constraint/, 'a bare code is not a hash');
  assert.throws(() => insert.run(1, HASH, 1, -1, 0), /CHECK constraint/);
  assert.throws(() => insert.run(1, HASH, 1, 0, 2), /CHECK constraint/);
  assert.throws(() => insert.run(99, HASH, 1, 0, 0), /FOREIGN KEY/);

  db.prepare('DELETE FROM users WHERE id = 1').run();
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM password_resets').get() as { n: number }).n, 0);
});

test('0005 on a fresh database gives the same schema as an upgraded one', () => {
  const fresh = memory();
  runMigrations(fresh, MIGRATIONS);
  assert.ok(
    (fresh.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).some(
      row => row.version === 5,
    ),
  );

  const upgraded = memory();
  runMigrations(upgraded, BEFORE);
  runMigrations(upgraded, MIGRATIONS);
  assert.deepEqual(schema(upgraded), schema(fresh));
});

test('the reset lookup uses the email index and the reset user index', () => {
  const db = memory();
  runMigrations(db, MIGRATIONS);
  const plan = (
    db
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT r.id, r.user_id, r.code_hash
         FROM password_resets r
         JOIN users u ON u.id = r.user_id
         WHERE u.email = ? AND r.used = 0 AND r.expires_at > ? AND r.attempts < ?
         ORDER BY r.id DESC
         LIMIT 1`,
      )
      .all('a@example.com', 0, 5) as { detail: string }[]
  ).map(row => row.detail);
  assert.ok(plan.some(detail => /SEARCH u USING (COVERING )?INDEX sqlite_autoindex_users/.test(detail)), plan.join(' | '));
  assert.ok(plan.some(detail => /SEARCH r USING INDEX idx_password_resets_user/.test(detail)), plan.join(' | '));
  assert.ok(!plan.some(detail => /SCAN/.test(detail)), plan.join(' | '));
});
