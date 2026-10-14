import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { runMigrations } from '../migrate.js';
import { MIGRATIONS } from './index.js';
import { baseline } from './0001_baseline.js';
import { integerMoney } from './0002_integer_money.js';

// Up to this migration only, so later migrations don't change what it checks.
const THROUGH = MIGRATIONS.filter(m => m.version <= 3);

function memory(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}

function schema(db: Database.Database): string[] {
  return (
    db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all() as {
      type: string;
      name: string;
      sql: string | null;
    }[]
  ).map(row => `${row.type} ${row.name} ${row.sql ?? ''}`);
}

test('0003 renames the stored Pidgin code pid to wes and leaves the rest', () => {
  const db = memory();
  runMigrations(db, [baseline, integerMoney]);
  db.exec(`
    INSERT INTO users (id, company_name, email, password_hash, language) VALUES
      (1, 'A', 'a@example.com', 'h', 'pid'),
      (2, 'B', 'b@example.com', 'h', 'fr'),
      (3, 'C', 'c@example.com', 'h', 'en'),
      (4, 'D', 'd@example.com', 'h', 'pid');
  `);

  runMigrations(db, THROUGH);

  const rows = db.prepare('SELECT id, language FROM users ORDER BY id').all();
  assert.deepEqual(rows, [
    { id: 1, language: 'wes' },
    { id: 2, language: 'fr' },
    { id: 3, language: 'en' },
    { id: 4, language: 'wes' },
  ]);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('0003 runs on a fresh database and leaves the schema unchanged', () => {
  const fresh = memory();
  runMigrations(fresh, THROUGH);
  const versions = (
    fresh.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as {
      version: number;
    }[]
  ).map(row => row.version);
  assert.ok(versions.includes(3));

  const before = memory();
  runMigrations(before, [baseline, integerMoney]);
  const schemaBefore = schema(before).filter(line => !line.includes('schema_migrations'));
  const schemaAfter = schema(fresh).filter(line => !line.includes('schema_migrations'));
  assert.deepEqual(schemaAfter, schemaBefore);
});
