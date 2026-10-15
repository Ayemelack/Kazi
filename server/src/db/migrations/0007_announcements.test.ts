import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { runMigrations } from '../migrate.js';
import { legacyMigrate } from '../legacyFixtures.js';
import { MIGRATIONS } from './index.js';

const BEFORE = MIGRATIONS.filter(m => m.version < 7);

// The statement main's pre-framework db.ts ran (merged 2026-10-15), verbatim.
const MAIN_ANNOUNCEMENTS_SQL = `
    CREATE TABLE IF NOT EXISTS announcements (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      body_en     TEXT NOT NULL DEFAULT '',
      body_fr     TEXT,
      body_pid    TEXT,
      min_version TEXT NOT NULL DEFAULT '',
      max_version TEXT NOT NULL DEFAULT '',
      active      INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
`;

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

test('0007 creates the announcements table on a database that lacks it', () => {
  const fresh = memory();
  runMigrations(fresh, MIGRATIONS);
  const upgraded = memory();
  runMigrations(upgraded, BEFORE);
  assert.ok(!schema(upgraded).some(line => line.startsWith('table announcements ')));
  runMigrations(upgraded, MIGRATIONS);
  assert.deepEqual(schema(upgraded), schema(fresh));
  assert.ok(schema(fresh).some(line => line.startsWith('table announcements ')));
  assert.deepEqual(upgraded.pragma('foreign_key_check'), []);
});

test('a database created by main\'s old boot code keeps its announcement and ends with the same schema', () => {
  const fromMain = memory();
  legacyMigrate(fromMain);
  fromMain.exec(MAIN_ANNOUNCEMENTS_SQL);
  fromMain.exec(`
    INSERT INTO announcements (id, body_en, body_fr, body_pid, min_version, max_version, active)
    VALUES (1, 'Stock check tomorrow', 'Inventaire demain', 'Stock check tumoro', '1.0', '', 1);
  `);

  runMigrations(fromMain, MIGRATIONS);

  const fresh = memory();
  runMigrations(fresh, MIGRATIONS);
  assert.deepEqual(schema(fromMain), schema(fresh));
  assert.deepEqual(
    fromMain.prepare('SELECT id, body_en, body_pid, active FROM announcements').all(),
    [{ id: 1, body_en: 'Stock check tomorrow', body_pid: 'Stock check tumoro', active: 1 }],
  );
  assert.deepEqual(fromMain.pragma('foreign_key_check'), []);
});
