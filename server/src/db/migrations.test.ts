import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import Database from 'better-sqlite3';
import { openDatabase } from './index.js';
import { appliedMigrations, runMigrations, type Migration } from './migrate.js';
import { MIGRATIONS } from './migrations/index.js';
import { LEGACY_SCHEMA_SQL, legacyMigrate } from './legacyFixtures.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kazi-migrations-'));
const opened: Database.Database[] = [];
// Every migration in this build, and a version no real migration uses yet.
const ALL_VERSIONS = MIGRATIONS.map(m => m.version);
const NEXT_VERSION = MIGRATIONS.at(-1)!.version + 1;

after(() => {
  for (const db of opened) {
    if (db.open) db.close();
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

function tempFile(name: string): string {
  return path.join(tmp, `${name}.db`);
}

function open(filename: string): Database.Database {
  const db = openDatabase({ filename });
  opened.push(db);
  return db;
}

type SchemaRow = { type: string; name: string; tbl_name: string; sql: string | null };

function schemaOf(db: Database.Database): SchemaRow[] {
  return db
    .prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name')
    .all() as SchemaRow[];
}

function freshSchema(): SchemaRow[] {
  const db = open(':memory:');
  return schemaOf(db);
}

function indexNames(db: Database.Database, table: string): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL ORDER BY name")
      .all(table) as { name: string }[]
  ).map(r => r.name);
}

// The original schema before 'capital' and before the columns that were added
// over time: the frozen legacy CREATE statements with the pre-capital CHECK.
function buildPreCapitalDatabase(filename: string): void {
  const raw = new Database(filename);
  const preCapital = LEGACY_SCHEMA_SQL.replace(
    "CHECK (type IN ('sale', 'purchase', 'capital'))",
    "CHECK (type IN ('sale', 'purchase'))",
  );
  assert.notEqual(preCapital, LEGACY_SCHEMA_SQL, 'fixture must drop capital from the CHECK');
  raw.exec(preCapital);
  raw.exec(`
    INSERT INTO users (id, company_name, email, password_hash) VALUES (1, 'Shop', 'a@example.com', 'hash');
    INSERT INTO items (id, user_id, name, type, price) VALUES (1, 1, 'Rice', 'product', 1500);
    INSERT INTO transactions (id, user_id, type, amount, item_id, quantity, description, date, created_at)
      VALUES (1, 1, 'sale', 3000, 1, 2, NULL, '2026-01-02', '2026-01-02 10:00:00'),
             (2, 1, 'purchase', 500, NULL, NULL, 'Transport', '2026-01-03', '2026-01-03 11:00:00'),
             (3, 1, 'sale', 100, NULL, NULL, 'later deleted', '2026-01-04', '2026-01-04 09:00:00');
    DELETE FROM transactions WHERE id = 3;
    INSERT INTO debts (id, user_id, name, amount, date) VALUES (1, 1, 'Ama', 2000, '2026-01-05');
    INSERT INTO activity (user_id, type, title, amount, event_date, created_at)
      VALUES (1, 'sale', 'Rice', 3000, NULL, '2026-01-02 10:00:00'),
             (1, 'expense', 'Transport', 500, '2026-01-03', '2026-01-03 11:00:00');
  `);
  raw.close();
}

test('fresh database: baseline applied once, full schema, foreign keys on and clean', () => {
  const db = open(':memory:');

  assert.deepEqual(
    appliedMigrations(db).map(m => [m.version, m.name]),
    MIGRATIONS.map(m => [m.version, m.name]),
  );

  const tables = schemaOf(db)
    .filter(r => r.type === 'table')
    .map(r => r.name);
  for (const table of [
    'users',
    'password_resets',
    'push_tokens',
    'items',
    'stock_movements',
    'transactions',
    'debts',
    'activity',
    'feedback',
    'client_ops',
    'schema_migrations',
  ]) {
    assert.ok(tables.includes(table), `missing table ${table}`);
  }
  // Dropped by 0004 (KZ-05).
  assert.ok(!tables.includes('password_fingerprints'));

  const itemColumns = (db.pragma('table_info(items)') as { name: string }[]).map(c => c.name);
  for (const column of ['stock', 'track_stock', 'low_stock_threshold', 'image']) {
    assert.ok(itemColumns.includes(column), `items.${column} missing`);
  }
  assert.deepEqual(indexNames(db, 'transactions'), [
    'idx_transactions_user_created',
    'idx_transactions_user_date',
    'idx_transactions_user_type_date',
  ]);

  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('pre-capital database upgrades without data loss and matches a fresh schema', () => {
  const file = tempFile('pre-capital');
  buildPreCapitalDatabase(file);

  const db = open(file);

  assert.deepEqual(schemaOf(db), freshSchema());
  assert.deepEqual(
    appliedMigrations(db).map(m => m.version),
    ALL_VERSIONS,
  );

  // Rows survive the transactions rebuild unchanged.
  assert.deepEqual(
    db
      .prepare('SELECT id, user_id, type, amount, item_id, quantity, description, date, created_at FROM transactions ORDER BY id')
      .all(),
    [
      {
        id: 1,
        user_id: 1,
        type: 'sale',
        amount: 3000,
        item_id: 1,
        quantity: 2,
        description: null,
        date: '2026-01-02',
        created_at: '2026-01-02 10:00:00',
      },
      {
        id: 2,
        user_id: 1,
        type: 'purchase',
        amount: 500,
        item_id: null,
        quantity: null,
        description: 'Transport',
        date: '2026-01-03',
        created_at: '2026-01-03 11:00:00',
      },
    ],
  );

  // 'capital' is accepted now, and ids of rows deleted before the rebuild are
  // not handed out again.
  const capital = db
    .prepare("INSERT INTO transactions (user_id, type, amount, date) VALUES (1, 'capital', 10000, '2026-01-06')")
    .run();
  assert.equal(capital.lastInsertRowid, 4);

  // Added columns get their defaults; NULL event dates are backfilled.
  assert.deepEqual(db.prepare('SELECT stock, track_stock, low_stock_threshold, image FROM items').get(), {
    stock: 0,
    track_stock: 0,
    low_stock_threshold: 0,
    image: null,
  });
  assert.deepEqual(db.prepare('SELECT token_version, first_name FROM users').get(), {
    token_version: 0,
    first_name: '',
  });
  assert.deepEqual(
    db.prepare('SELECT event_date FROM activity ORDER BY id').all(),
    [{ event_date: '2026-01-02' }, { event_date: '2026-01-03' }],
  );
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM debts').get() as { n: number }).n, 1);

  // KZ-26: the rebuild used to drop idx_transactions_user_type_date.
  assert.deepEqual(indexNames(db, 'transactions'), [
    'idx_transactions_user_created',
    'idx_transactions_user_date',
    'idx_transactions_user_type_date',
  ]);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('database created by the pre-framework boot code is baselined to an identical schema', () => {
  const file = tempFile('pre-framework');
  const raw = new Database(file);
  raw.pragma('foreign_keys = ON');
  legacyMigrate(raw);
  raw.exec(`
    INSERT INTO users (company_name, email, password_hash) VALUES ('Shop', 'b@example.com', 'hash');
    INSERT INTO transactions (user_id, type, amount, date) VALUES (1, 'capital', 5000, '2026-02-01');
  `);
  raw.close();

  const db = open(file);

  assert.deepEqual(schemaOf(db), freshSchema());
  assert.deepEqual(
    appliedMigrations(db).map(m => m.version),
    ALL_VERSIONS,
  );
  assert.deepEqual(db.prepare('SELECT type, amount FROM transactions').all(), [
    { type: 'capital', amount: 5000 },
  ]);
});

test('opening the same database twice is a no-op', () => {
  const file = tempFile('reopen');
  const first = open(file);
  first.prepare("INSERT INTO users (company_name, email, password_hash) VALUES ('Shop', 'c@example.com', 'hash')").run();
  const schemaBefore = schemaOf(first);
  const appliedBefore = appliedMigrations(first);
  first.close();

  const second = open(file);

  assert.deepEqual(schemaOf(second), schemaBefore);
  assert.deepEqual(appliedMigrations(second), appliedBefore);
  assert.equal((second.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n, 1);
});

test('a failing migration rolls back and is not recorded', () => {
  const db = open(':memory:');
  const failing: Migration = {
    version: NEXT_VERSION,
    name: 'failing',
    up(conn) {
      conn.exec('CREATE TABLE half_done (id INTEGER PRIMARY KEY)');
      throw new Error('boom');
    },
  };

  assert.throws(() => runMigrations(db, [...MIGRATIONS, failing]), /boom/);

  assert.equal(
    db.prepare("SELECT name FROM sqlite_master WHERE name = 'half_done'").get(),
    undefined,
  );
  assert.deepEqual(
    appliedMigrations(db).map(m => m.version),
    ALL_VERSIONS,
  );
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
});

test('a migration that leaves a foreign key violation rolls back', () => {
  const db = open(':memory:');
  const orphaning: Migration = {
    version: NEXT_VERSION,
    name: 'orphaning',
    up(conn) {
      conn
        .prepare("INSERT INTO debts (user_id, name, amount, date) VALUES (999, 'Nobody', 1, '2026-01-01')")
        .run();
    },
  };

  assert.throws(() => runMigrations(db, [...MIGRATIONS, orphaning]), /foreign key violation/);

  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM debts').get() as { n: number }).n, 0);
  assert.deepEqual(
    appliedMigrations(db).map(m => m.version),
    ALL_VERSIONS,
  );
});

test('migrations must have strictly increasing versions', () => {
  const db = open(':memory:');
  const duplicate: Migration = { version: 1, name: 'duplicate', up() {} };
  assert.throws(() => runMigrations(db, [...MIGRATIONS, duplicate]), /strictly increasing/);
});
