import type Database from 'better-sqlite3';
import { log } from '../../log.js';
import type { Migration } from '../migrate.js';

// KZ-25: money is whole FCFA (ADR A6). The baseline stored amounts and prices
// as REAL, so a fraction could be saved and summed. SQLite can't change a
// column's type or CHECK in place, so each table is rebuilt with INTEGER
// columns and a CHECK that the stored value really is an integer (INTEGER
// affinity alone would still keep 12.5 as a REAL).
//
// Existing values are rounded half away from zero. A positive amount below 0.5
// would round to 0 and break "amount > 0", so it becomes 1 FCFA instead. Only
// the number of rounded rows is logged, never the values.
//
// Never edit this migration once applied. Change the schema with a new file.

interface MoneyTable {
  name: string;
  /** The column holding money in this table. */
  money: string;
  /** SQL expression that turns the old value into the new one. */
  convert: string;
  /** Full definition, created under the table's real name. */
  create: string;
}

const TABLES: readonly MoneyTable[] = [
  {
    name: 'items',
    money: 'price',
    convert: 'MAX(CAST(ROUND(price) AS INTEGER), 0)',
    create: `CREATE TABLE items (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name                TEXT NOT NULL,
      type                TEXT NOT NULL CHECK (type IN ('product', 'service')),
      price               INTEGER NOT NULL DEFAULT 0 CHECK (typeof(price) = 'integer' AND price >= 0),
      notes               TEXT,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
      stock               INTEGER NOT NULL DEFAULT 0,
      track_stock         INTEGER NOT NULL DEFAULT 0,
      low_stock_threshold INTEGER NOT NULL DEFAULT 0,
      image               TEXT
    )`,
  },
  {
    name: 'transactions',
    money: 'amount',
    convert: 'MAX(CAST(ROUND(amount) AS INTEGER), 1)',
    create: `CREATE TABLE transactions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type        TEXT NOT NULL CHECK (type IN ('sale', 'purchase', 'capital')),
      amount      INTEGER NOT NULL CHECK (typeof(amount) = 'integer' AND amount > 0),
      item_id     INTEGER REFERENCES items(id) ON DELETE SET NULL,
      quantity    INTEGER,
      description TEXT,
      date        TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  },
  {
    name: 'debts',
    money: 'amount',
    convert: 'MAX(CAST(ROUND(amount) AS INTEGER), 1)',
    create: `CREATE TABLE debts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      amount     INTEGER NOT NULL CHECK (typeof(amount) = 'integer' AND amount > 0),
      note       TEXT,
      date       TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      paid_at    TEXT
    )`,
  },
  {
    // History rows without money (stock moves, item edits) keep a NULL amount.
    name: 'activity',
    money: 'amount',
    convert: 'CAST(ROUND(amount) AS INTEGER)',
    create: `CREATE TABLE activity (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type       TEXT NOT NULL,
      title      TEXT,
      amount     INTEGER CHECK (amount IS NULL OR typeof(amount) = 'integer'),
      quantity   INTEGER,
      event_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      ref_type   TEXT,
      ref_id     INTEGER
    )`,
  },
];

export const integerMoney: Migration = {
  version: 2,
  name: 'integer_money',
  up(db) {
    const rounded = countFractionalMoney(db);

    // With legacy_alter_table off, renaming a table also rewrites the
    // REFERENCES clauses of the tables that point at it (stock_movements and
    // transactions point at items), which would leave them pointing at the
    // dropped copy. On, the rename touches only the table itself.
    db.pragma('legacy_alter_table = ON');
    try {
      for (const table of TABLES) {
        rebuild(db, table);
      }
    } finally {
      db.pragma('legacy_alter_table = OFF');
    }

    const total = Object.values(rounded).reduce((sum, n) => sum + n, 0);
    if (total > 0) {
      const detail = Object.entries(rounded)
        .map(([name, n]) => `${name}: ${n}`)
        .join(', ');
      log.warn(`Migration 0002: rounded ${total} fractional money value(s) to whole FCFA (${detail}).`);
    }
  },
};

/** Rows per table whose money column holds a fraction. Counts only. */
export function countFractionalMoney(db: Database.Database): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { name, money } of TABLES) {
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM ${name} WHERE ${money} IS NOT NULL AND ${money} <> ROUND(${money})`)
      .get() as { n: number };
    counts[name] = row.n;
  }
  return counts;
}

// The old table is moved aside, the new definition is created under the real
// name (so sqlite_master stores it unquoted), rows are copied with the money
// column converted, and the old table is dropped. Dropping it drops its
// indexes, so every index (and trigger) it had is recreated from its own SQL.
// The runner has foreign keys off and runs this in one transaction, then
// checks foreign keys before committing.
function rebuild(db: Database.Database, table: MoneyTable): void {
  const { name, money, convert, create } = table;
  const dependents = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type IN ('index', 'trigger') AND tbl_name = ? AND sql IS NOT NULL ORDER BY type, name",
    )
    .all(name) as { sql: string }[];
  const sequence = db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get(name) as
    | { seq: number }
    | undefined;
  const columns = (db.pragma(`table_info(${name})`) as { name: string }[]).map(c => c.name);
  const select = columns.map(c => (c === money ? `${convert} AS ${c}` : c)).join(', ');

  db.exec(`
    ALTER TABLE ${name} RENAME TO ${name}_legacy;
    ${create};
    INSERT INTO ${name} (${columns.join(', ')}) SELECT ${select} FROM ${name}_legacy;
    DROP TABLE ${name}_legacy;
  `);

  for (const { sql } of dependents) {
    db.exec(sql);
  }

  // Keep AUTOINCREMENT from reusing ids of rows deleted before the rebuild.
  if (sequence) {
    db.prepare('DELETE FROM sqlite_sequence WHERE name = ?').run(name);
    const highest = db.prepare(`SELECT MAX(id) AS id FROM ${name}`).get() as { id: number | null };
    db.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)').run(
      name,
      Math.max(sequence.seq, highest.id ?? 0),
    );
  }
}
