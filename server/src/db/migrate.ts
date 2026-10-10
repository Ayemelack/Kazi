import type Database from 'better-sqlite3';
import { log } from '../log.js';

export interface Migration {
  /** Unique, increasing. Matches the NNNN prefix of the file name. */
  version: number;
  name: string;
  up(db: Database.Database): void;
}

export interface AppliedMigration {
  version: number;
  name: string;
  applied_at: string;
}

/**
 * Applies every migration newer than the database's recorded version, in
 * order. Each migration runs in its own transaction with foreign keys off (so
 * a table can be rebuilt) and must leave PRAGMA foreign_key_check clean before
 * it commits; otherwise it rolls back and the error propagates.
 *
 * A database created before this framework existed has the application tables
 * but no schema_migrations table. Migration 0001 (the baseline) is idempotent,
 * so it upgrades such a database in place and is then recorded as applied.
 */
export function runMigrations(db: Database.Database, migrations: readonly Migration[]): void {
  assertOrdered(migrations);

  const preFramework = !tableExists(db, 'schema_migrations') && tableExists(db, 'users');

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

  const current =
    (db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
      version: number | null;
    }).version ?? 0;

  const latest = migrations.at(-1)?.version ?? 0;
  if (current > latest) {
    log.warn(
      `Database schema version ${current} is newer than this build (${latest}); no migrations run.`,
    );
    return;
  }

  const pending = migrations.filter(m => m.version > current);
  if (pending.length === 0) {
    return;
  }

  if (preFramework && !db.memory) {
    log.info('Existing database without schema_migrations found; baselining it.');
  }

  const record = db.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  );

  for (const migration of pending) {
    // foreign_keys can't change inside a transaction, so switch it around it.
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        migration.up(db);
        const violations = db.pragma('foreign_key_check') as unknown[];
        if (violations.length > 0) {
          throw new Error(
            `Migration ${migration.version}_${migration.name} left ${violations.length} foreign key violation(s)`,
          );
        }
        record.run(migration.version, migration.name, new Date().toISOString());
      })();
    } finally {
      db.pragma('foreign_keys = ON');
    }
    if (!db.memory) {
      log.info(`Applied database migration ${migration.version}_${migration.name}`);
    }
  }
}

export function appliedMigrations(db: Database.Database): AppliedMigration[] {
  return db
    .prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version')
    .all() as AppliedMigration[];
}

function tableExists(db: Database.Database, name: string): boolean {
  return (
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !==
    undefined
  );
}

function assertOrdered(migrations: readonly Migration[]): void {
  migrations.forEach((m, i) => {
    const previous = i === 0 ? 0 : migrations[i - 1]!.version;
    if (!Number.isInteger(m.version) || m.version <= previous) {
      throw new Error(`Migrations must have strictly increasing versions (at ${m.name})`);
    }
  });
}
