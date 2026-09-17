import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface Options {
  filename?: string;
}

export function resolveDatabasePath(): string {
  return process.env.DATABASE_PATH ?? path.join(__dirname, '..', 'data', 'kazi.db');
}

export function openDatabase({ filename }: Options = {}): Database.Database {
  const location = filename ?? resolveDatabasePath();

  if (location !== ':memory:') {
    fs.mkdirSync(path.dirname(location), { recursive: true });
  }

  const db = new Database(location);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  migrate(db);
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      company_name  TEXT NOT NULL,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      language      TEXT NOT NULL DEFAULT 'en',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      used       INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);

    CREATE TABLE IF NOT EXISTS push_tokens (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token      TEXT NOT NULL UNIQUE,
      platform   TEXT NOT NULL DEFAULT 'android',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id);

    CREATE TABLE IF NOT EXISTS items (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      type       TEXT NOT NULL CHECK (type IN ('product', 'service')),
      price      REAL NOT NULL DEFAULT 0,
      notes      TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_items_user ON items(user_id);

    CREATE TABLE IF NOT EXISTS stock_movements (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id        INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      direction      TEXT NOT NULL CHECK (direction IN ('in', 'out')),
      quantity       INTEGER NOT NULL,
      new_quantity   INTEGER NOT NULL,
      reason         TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_stock_movements_item ON stock_movements(item_id, created_at);

    CREATE TABLE IF NOT EXISTS transactions (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type           TEXT NOT NULL CHECK (type IN ('sale', 'purchase', 'capital')),
      amount         REAL NOT NULL CHECK (amount > 0),
      item_id        INTEGER REFERENCES items(id) ON DELETE SET NULL,
      quantity       INTEGER,
      description    TEXT,
      date           TEXT NOT NULL,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions(user_id, date DESC);
    CREATE INDEX IF NOT EXISTS idx_transactions_user_created ON transactions(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS debts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      amount     REAL NOT NULL CHECK (amount > 0),
      note       TEXT,
      date       TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_debts_user_status ON debts(user_id, status, date DESC);

    CREATE TABLE IF NOT EXISTS activity (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type       TEXT NOT NULL,
      title      TEXT,
      amount     REAL,
      quantity   INTEGER,
      event_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_activity_user_created ON activity(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS feedback (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      liked      TEXT,
      disliked   TEXT,
      suggestion TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id);

    CREATE TABLE IF NOT EXISTS client_ops (
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_op_id TEXT NOT NULL,
      op_type      TEXT NOT NULL,
      response     TEXT NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, client_op_id)
    );

    CREATE INDEX IF NOT EXISTS idx_client_ops_user ON client_ops(user_id, created_at);
  `);

  addColumnIfMissing(db, 'items', 'stock', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'items', 'track_stock', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'items', 'low_stock_threshold', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'items', 'image', 'TEXT');
  addColumnIfMissing(db, 'users', 'first_name', 'TEXT NOT NULL DEFAULT \'\'');
  addColumnIfMissing(db, 'users', 'last_name', 'TEXT NOT NULL DEFAULT \'\'');
  addColumnIfMissing(db, 'users', 'business_type', 'TEXT NOT NULL DEFAULT \'\'');
  addColumnIfMissing(db, 'users', 'token_version', 'INTEGER NOT NULL DEFAULT 0');
  migrateTransactionsTable(db);
}

function migrateTransactionsTable(db: Database.Database): void {
  const table = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'transactions'")
    .get() as { sql: string } | undefined;

  if (!table || table.sql.includes("'capital'")) {
    return;
  }

  db.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN;
    CREATE TABLE transactions_new (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type           TEXT NOT NULL CHECK (type IN ('sale', 'purchase', 'capital')),
      amount         REAL NOT NULL CHECK (amount > 0),
      item_id        INTEGER REFERENCES items(id) ON DELETE SET NULL,
      quantity       INTEGER,
      description    TEXT,
      date           TEXT NOT NULL,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO transactions_new (id, user_id, type, amount, item_id, quantity, description, date, created_at)
      SELECT id, user_id, type, amount, item_id, quantity, description, date, created_at
      FROM transactions;
    DROP TABLE transactions;
    ALTER TABLE transactions_new RENAME TO transactions;
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions(user_id, date DESC);
    CREATE INDEX IF NOT EXISTS idx_transactions_user_created ON transactions(user_id, created_at DESC);
  `);
}

function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  const columns = db.pragma(`table_info(${table})`) as { name: string }[];
  const exists = columns.some(c => c.name === column);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}