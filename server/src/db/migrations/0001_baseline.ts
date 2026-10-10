import type Database from 'better-sqlite3';
import type { Migration } from '../migrate.js';

// The schema as it stood when numbered migrations were introduced, built by
// the same steps the old boot-time migrate() ran: CREATE ... IF NOT EXISTS,
// the columns that were added over time, the activity event_date backfill and
// the rebuild that let transactions hold 'capital'.
//
// Every step is idempotent, so the same code creates a fresh database and
// baselines a database created before schema_migrations existed, without
// losing data. The SQL text is kept byte-for-byte as before so a fresh
// database and an upgraded one end with an identical sqlite_master.
//
// Never edit this migration. Change the schema with a new numbered file.

const TRANSACTIONS_TABLE = `CREATE TABLE IF NOT EXISTS transactions (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type           TEXT NOT NULL CHECK (type IN ('sale', 'purchase', 'capital')),
      amount         REAL NOT NULL CHECK (amount > 0),
      item_id        INTEGER REFERENCES items(id) ON DELETE SET NULL,
      quantity       INTEGER,
      description    TEXT,
      date           TEXT NOT NULL,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    )`;

// Every index on transactions. They are created again after the rebuild below,
// because dropping the old table drops its indexes (this is KZ-26: the old
// rebuild restored only two of the three).
const TRANSACTIONS_INDEXES = `
    CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions(user_id, date DESC);
    CREATE INDEX IF NOT EXISTS idx_transactions_user_created ON transactions(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_transactions_user_type_date ON transactions(user_id, type, date DESC);
`;

const SCHEMA = `
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

    ${TRANSACTIONS_TABLE};

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

    CREATE TABLE IF NOT EXISTS password_fingerprints (
      fingerprint TEXT PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_password_fingerprints_user ON password_fingerprints(user_id);
    CREATE INDEX IF NOT EXISTS idx_activity_user_date ON activity(user_id, event_date DESC, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_transactions_user_type_date ON transactions(user_id, type, date DESC);
`;

export const baseline: Migration = {
  version: 1,
  name: 'baseline',
  up(db) {
    db.exec(SCHEMA);

    addColumnIfMissing(db, 'items', 'stock', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing(db, 'items', 'track_stock', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing(db, 'items', 'low_stock_threshold', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing(db, 'items', 'image', 'TEXT');
    addColumnIfMissing(db, 'users', 'first_name', 'TEXT NOT NULL DEFAULT \'\'');
    addColumnIfMissing(db, 'users', 'last_name', 'TEXT NOT NULL DEFAULT \'\'');
    addColumnIfMissing(db, 'users', 'business_type', 'TEXT NOT NULL DEFAULT \'\'');
    addColumnIfMissing(db, 'users', 'token_version', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing(db, 'debts', 'paid_at', 'TEXT');
    // History events carry a link back to the record that produced them so a
    // delete of the authoritative record can remove its event log entry too.
    addColumnIfMissing(db, 'activity', 'ref_type', 'TEXT');
    addColumnIfMissing(db, 'activity', 'ref_id', 'INTEGER');
    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_activity_ref ON activity(user_id, ref_type, ref_id)',
    );
    backfillActivityEventDates(db);
    rebuildTransactionsForCapital(db);
    db.exec(TRANSACTIONS_INDEXES);
  },
};

// Historical rows were allowed to have a NULL event_date and were filtered on
// substr(created_at, 1, 10) instead. Date filtering now uses event_date alone,
// so every existing row must be given one. created_at is stored in UTC by
// SQLite, which is the best approximation available for rows written before
// this migration; new rows always receive their business date at insert time.
function backfillActivityEventDates(db: Database.Database): void {
  db.exec(
    `UPDATE activity SET event_date = substr(created_at, 1, 10) WHERE event_date IS NULL`,
  );
}

// Databases created before 'capital' existed have a CHECK that rejects it.
// SQLite can't alter a CHECK, so the table is rebuilt: the old table is moved
// aside, the current definition is created under the real name (so its
// sqlite_master text matches a fresh database), rows are copied and the old
// table is dropped. The migration runner has foreign keys off and runs this in
// a transaction, then checks foreign keys before committing.
function rebuildTransactionsForCapital(db: Database.Database): void {
  const table = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'transactions'")
    .get() as { sql: string } | undefined;

  if (!table || table.sql.includes("'capital'")) {
    return;
  }

  const sequence = db
    .prepare("SELECT seq FROM sqlite_sequence WHERE name = 'transactions'")
    .get() as { seq: number } | undefined;

  db.exec(`
    ALTER TABLE transactions RENAME TO transactions_legacy;
    ${TRANSACTIONS_TABLE};
    INSERT INTO transactions (id, user_id, type, amount, item_id, quantity, description, date, created_at)
      SELECT id, user_id, type, amount, item_id, quantity, description, date, created_at
      FROM transactions_legacy;
    DROP TABLE transactions_legacy;
  `);

  // Keep AUTOINCREMENT from reusing ids of rows deleted before the rebuild.
  if (sequence) {
    const copied = db
      .prepare("SELECT seq FROM sqlite_sequence WHERE name = 'transactions'")
      .get() as { seq: number } | undefined;
    if (!copied) {
      db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('transactions', ?)").run(
        sequence.seq,
      );
    } else if (copied.seq < sequence.seq) {
      db.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = 'transactions'").run(
        sequence.seq,
      );
    }
  }
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
