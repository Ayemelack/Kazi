import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { log } from '../../log.js';
import { runMigrations } from '../migrate.js';
import { MIGRATIONS } from './index.js';
import { baseline } from './0001_baseline.js';
import { countFractionalMoney } from './0002_integer_money.js';

const MONEY_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ['items', 'price'],
  ['transactions', 'amount'],
  ['debts', 'amount'],
  ['activity', 'amount'],
];

function memory(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}

function columnType(db: Database.Database, table: string, column: string): string {
  const columns = db.pragma(`table_info(${table})`) as { name: string; type: string }[];
  return columns.find(c => c.name === column)?.type ?? '';
}

function indexSql(db: Database.Database): string[] {
  return (
    db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name")
      .all() as { sql: string }[]
  ).map(r => r.sql);
}

// A database as it stood after 0001 only, holding REAL money with fractions.
function baselineWithFractions(): Database.Database {
  const db = memory();
  runMigrations(db, [baseline]);
  db.exec(`
    INSERT INTO users (id, company_name, email, password_hash) VALUES (1, 'Shop', 'a@example.com', 'hash');
    INSERT INTO items (id, user_id, name, type, price, stock, track_stock) VALUES
      (1, 1, 'Rice', 'product', 1500.5, 4, 1),
      (2, 1, 'Soap', 'product', 250, 0, 0),
      (3, 1, 'Gone', 'product', 10, 0, 0);
    DELETE FROM items WHERE id = 3;
    INSERT INTO stock_movements (item_id, user_id, direction, quantity, new_quantity) VALUES (1, 1, 'in', 4, 4);
    INSERT INTO transactions (id, user_id, type, amount, item_id, quantity, date) VALUES
      (1, 1, 'sale', 3000.4, 1, 2, '2026-01-02'),
      (2, 1, 'purchase', 0.3, NULL, NULL, '2026-01-03'),
      (3, 1, 'capital', 5000, NULL, NULL, '2026-01-04'),
      (4, 1, 'sale', 2.5, 2, 1, '2026-01-05');
    INSERT INTO debts (id, user_id, name, amount, date) VALUES
      (1, 1, 'Ama', 1999.5, '2026-01-05'),
      (2, 1, 'Paul', 700, '2026-01-06');
    INSERT INTO activity (user_id, type, title, amount, event_date) VALUES
      (1, 'sale', 'Rice', 3000.4, '2026-01-02'),
      (1, 'stock_in', 'Rice', NULL, '2026-01-02'),
      (1, 'expense', 'Transport', 0.3, '2026-01-03');
  `);
  return db;
}

test('0002 on a fresh database: INTEGER money columns with CHECKs, FKs clean', () => {
  const db = memory();
  runMigrations(db, MIGRATIONS);

  for (const [table, column] of MONEY_COLUMNS) {
    assert.equal(columnType(db, table, column), 'INTEGER', `${table}.${column}`);
  }
  assert.deepEqual(db.pragma('foreign_key_check'), []);

  db.exec(
    "INSERT INTO users (id, company_name, email, password_hash) VALUES (1, 'Shop', 'b@example.com', 'hash')",
  );
  const insertSale = db.prepare(
    "INSERT INTO transactions (user_id, type, amount, date) VALUES (1, 'sale', ?, '2026-01-01')",
  );
  insertSale.run(1000);
  assert.throws(() => insertSale.run(12.5), /CHECK constraint failed/);
  assert.throws(() => insertSale.run(0), /CHECK constraint failed/);
  const insertItem = db.prepare(
    "INSERT INTO items (user_id, name, type, price) VALUES (1, 'Rice', 'product', ?)",
  );
  insertItem.run(0);
  assert.throws(() => insertItem.run(2500.5), /CHECK constraint failed/);
  assert.throws(() => insertItem.run(-1), /CHECK constraint failed/);
  assert.throws(
    () => db.prepare("INSERT INTO debts (user_id, name, amount, date) VALUES (1, 'A', 1.5, '2026-01-01')").run(),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => db.prepare("INSERT INTO activity (user_id, type, amount) VALUES (1, 'sale', 1.5)").run(),
    /CHECK constraint failed/,
  );
  db.prepare("INSERT INTO activity (user_id, type, amount) VALUES (1, 'stock_in', NULL)").run();
});

test('0002 rounds fractional money, keeps every row, index, FK and sequence', () => {
  const db = baselineWithFractions();
  const indexesBefore = indexSql(db);
  const sequenceBefore = db.prepare('SELECT name, seq FROM sqlite_sequence ORDER BY name').all();
  const counts = countFractionalMoney(db);
  assert.deepEqual(counts, { items: 1, transactions: 3, debts: 1, activity: 2 });

  const warnings: string[] = [];
  const originalWarn = log.warn;
  log.warn = (...args: unknown[]) => {
    warnings.push(args.join(' '));
  };
  try {
    runMigrations(db, MIGRATIONS);
  } finally {
    log.warn = originalWarn;
  }

  // Only the count is logged, never an amount.
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /rounded 7 fractional money value\(s\)/);
  assert.doesNotMatch(warnings[0]!, /1500|3000|1999|0\.3|2\.5/);

  assert.deepEqual(
    db.prepare('SELECT id, price, typeof(price) AS t FROM items ORDER BY id').all(),
    [
      { id: 1, price: 1501, t: 'integer' },
      { id: 2, price: 250, t: 'integer' },
    ],
  );
  assert.deepEqual(
    db.prepare('SELECT id, amount, typeof(amount) AS t, item_id FROM transactions ORDER BY id').all(),
    [
      { id: 1, amount: 3000, t: 'integer', item_id: 1 },
      // 0.3 would round to 0 and break "amount > 0"; it becomes 1 FCFA.
      { id: 2, amount: 1, t: 'integer', item_id: null },
      { id: 3, amount: 5000, t: 'integer', item_id: null },
      // Half rounds away from zero.
      { id: 4, amount: 3, t: 'integer', item_id: 2 },
    ],
  );
  assert.deepEqual(db.prepare('SELECT amount FROM debts ORDER BY id').all(), [
    { amount: 2000 },
    { amount: 700 },
  ]);
  assert.deepEqual(db.prepare('SELECT amount FROM activity ORDER BY id').all(), [
    { amount: 3000 },
    { amount: null },
    { amount: 0 },
  ]);
  assert.deepEqual(countFractionalMoney(db), { items: 0, transactions: 0, debts: 0, activity: 0 });

  // Every index came back, and the AUTOINCREMENT counters didn't go back.
  assert.deepEqual(indexSql(db), indexesBefore);
  assert.deepEqual(db.prepare('SELECT name, seq FROM sqlite_sequence ORDER BY name').all(), sequenceBefore);

  // The child tables still point at items, not at the dropped copy, and the
  // foreign keys still act.
  for (const table of ['stock_movements', 'transactions']) {
    const fks = db.pragma(`foreign_key_list(${table})`) as { table: string; from: string }[];
    assert.ok(fks.some(fk => fk.from === 'item_id' && fk.table === 'items'), table);
  }
  assert.doesNotMatch(
    (db.prepare("SELECT group_concat(sql, ' ') AS sql FROM sqlite_master").get() as { sql: string }).sql,
    /_legacy/,
  );
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  db.prepare('DELETE FROM items WHERE id = 1').run();
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS n FROM stock_movements').get() as { n: number }).n,
    0,
    'ON DELETE CASCADE still applies',
  );
  assert.equal(
    (db.prepare('SELECT item_id FROM transactions WHERE id = 1').get() as { item_id: number | null }).item_id,
    null,
    'ON DELETE SET NULL still applies',
  );
});

test('0002 leaves an upgraded database with the same schema as a fresh one', () => {
  const fresh = memory();
  runMigrations(fresh, MIGRATIONS);
  const upgraded = baselineWithFractions();
  runMigrations(upgraded, MIGRATIONS);
  const schema = (db: Database.Database) =>
    db.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name').all();
  assert.deepEqual(schema(upgraded), schema(fresh));
});
