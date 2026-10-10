import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';
import { MIGRATIONS } from './migrations/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface Options {
  filename?: string;
}

export function resolveDatabasePath(): string {
  // src/db (tsx) and dist/db (build) both sit two levels below server/.
  return process.env.DATABASE_PATH ?? path.join(__dirname, '..', '..', 'data', 'kazi.db');
}

export function openDatabase({ filename }: Options = {}): Database.Database {
  const location = filename ?? resolveDatabasePath();

  if (location !== ':memory:') {
    fs.mkdirSync(path.dirname(location), { recursive: true });
  }

  const db = new Database(location);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db, MIGRATIONS);
  return db;
}
