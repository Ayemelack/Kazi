import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { runMigrations } from '../migrate.js';
import { MIGRATIONS } from './index.js';
import { baseline } from './0001_baseline.js';
import { integerMoney } from './0002_integer_money.js';
import { languageWes } from './0003_language_wes.js';

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

function hasFingerprintObjects(db: Database.Database): boolean {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE '%password_fingerprints%'")
    .get() as { n: number };
  return row.n > 0;
}

test('0004 drops password_fingerprints and its index and keeps the accounts', () => {
  const db = memory();
  runMigrations(db, [baseline, integerMoney, languageWes]);
  db.exec(`
    INSERT INTO users (id, company_name, email, password_hash) VALUES
      (1, 'A', 'a@example.com', 'h1'),
      (2, 'B', 'b@example.com', 'h2');
    INSERT INTO password_fingerprints (fingerprint, user_id) VALUES ('f1', 1), ('f2', 2);
  `);
  assert.equal(hasFingerprintObjects(db), true);

  runMigrations(db, MIGRATIONS);

  assert.equal(hasFingerprintObjects(db), false);
  assert.deepEqual(db.prepare('SELECT id, password_hash FROM users ORDER BY id').all(), [
    { id: 1, password_hash: 'h1' },
    { id: 2, password_hash: 'h2' },
  ]);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  // Deleting a user still works with the table gone.
  db.prepare('DELETE FROM users WHERE id = 1').run();
});

test('0004 on a fresh database: no fingerprints table, same schema as an upgraded one', () => {
  const fresh = memory();
  runMigrations(fresh, MIGRATIONS);
  assert.equal(hasFingerprintObjects(fresh), false);
  assert.ok(
    (fresh.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).some(
      row => row.version === 4,
    ),
  );

  const upgraded = memory();
  runMigrations(upgraded, [baseline, integerMoney, languageWes]);
  runMigrations(upgraded, MIGRATIONS);
  assert.deepEqual(schema(upgraded), schema(fresh));
});
