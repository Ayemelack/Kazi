import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { runMigrations } from '../migrate.js';
import { legacyMigrate } from '../legacyFixtures.js';
import { MIGRATIONS } from './index.js';

const BEFORE = MIGRATIONS.filter(m => m.version < 9);

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

test('0009 adds last_seen_at, the opt-in flag and the dedupe slot', () => {
  const db = memory();
  runMigrations(db, BEFORE);
  db.exec(`
    INSERT INTO users (id, company_name, email, password_hash) VALUES (1, 'A', 'a@example.com', 'h1');
    INSERT INTO users (id, company_name, email, password_hash) VALUES (2, 'B', 'b@example.com', 'h2');
  `);

  runMigrations(db, MIGRATIONS);

  // Two plain added columns with conservative defaults: every existing account
  // keeps its pushes but is NOT enrolled in inactivity nudges, and has no
  // recorded activity yet (so it is never "inactive" until it opens the app).
  assert.deepEqual(
    db
      .prepare('SELECT id, push_notifications, inactivity_notifications, last_seen_at, inactivity_notified_at FROM users ORDER BY id')
      .all(),
    [
      {
        id: 1,
        push_notifications: 1,
        inactivity_notifications: 0,
        last_seen_at: null,
        inactivity_notified_at: null,
      },
      {
        id: 2,
        push_notifications: 1,
        inactivity_notifications: 0,
        last_seen_at: null,
        inactivity_notified_at: null,
      },
    ],
  );

  const columns = (db.pragma('table_info(users)') as { name: string }[]).map(c => c.name);
  for (const column of ['last_seen_at', 'inactivity_notifications', 'inactivity_notified_at']) {
    assert.ok(columns.includes(column), `users.${column} missing`);
  }
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('0009 on a fresh database gives the same schema as an upgraded one', () => {
  const fresh = memory();
  runMigrations(fresh, MIGRATIONS);
  const upgraded = memory();
  runMigrations(upgraded, BEFORE);
  runMigrations(upgraded, MIGRATIONS);
  assert.deepEqual(schema(upgraded), schema(fresh));

  const optIn = (
    fresh.pragma('table_info(users)') as { name: string; dflt_value: string | null }[]
  ).find(field => field.name === 'inactivity_notifications');
  assert.equal(optIn?.dflt_value, '0', 'accounts created after the migration start opted out');
});

test('a database created by the pre-framework boot code gains the columns', () => {
  const legacy = memory();
  legacyMigrate(legacy);
  legacy.exec("INSERT INTO users (company_name, email, password_hash) VALUES ('Shop', 'c@example.com', 'hash')");

  runMigrations(legacy, MIGRATIONS);

  const fresh = memory();
  runMigrations(fresh, MIGRATIONS);
  assert.deepEqual(schema(legacy), schema(fresh));
  assert.deepEqual(
    legacy.prepare('SELECT inactivity_notifications, last_seen_at FROM users').all(),
    [{ inactivity_notifications: 0, last_seen_at: null }],
  );
  assert.deepEqual(legacy.pragma('foreign_key_check'), []);
});
