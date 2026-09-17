import type Database from 'better-sqlite3';

// Every query in this module is read-only. The admin server opens the database
// with { readonly: true } so it can never mutate application data.

function scalar<T>(db: Database.Database, sql: string, params: unknown[] = []): T {
  const row = db.prepare(sql).get(...params) as Record<string, unknown> | undefined;
  if (!row) {
    throw new Error('Expected a row but received none.');
  }
  const [value] = Object.values(row);
  return value as T;
}

function num(db: Database.Database, sql: string, params: unknown[] = []): number {
  const value = scalar<unknown>(db, sql, params);
  return typeof value === 'number' ? value : Number(value ?? 0);
}

export interface Stats {
  users: number;
  newUsers7d: number;
  newUsers30d: number;
  items: number;
  transactions: number;
  sales: number;
  purchases: number;
  capitalEvents: number;
  openDebts: number;
  paidDebts: number;
  feedbackCount: number;
  avgRating: number;
  totalReceived: number;
  totalSpent: number;
  totalCapital: number;
}

export function getStats(db: Database.Database): Stats {
  return {
    users: num(db, 'SELECT COUNT(*) FROM users'),
    newUsers7d: num(
      db,
      "SELECT COUNT(*) FROM users WHERE created_at >= datetime('now', '-7 days')",
    ),
    newUsers30d: num(
      db,
      "SELECT COUNT(*) FROM users WHERE created_at >= datetime('now', '-30 days')",
    ),
    items: num(db, 'SELECT COUNT(*) FROM items'),
    transactions: num(db, 'SELECT COUNT(*) FROM transactions'),
    sales: num(db, "SELECT COUNT(*) FROM transactions WHERE type = 'sale'"),
    purchases: num(db, "SELECT COUNT(*) FROM transactions WHERE type = 'purchase'"),
    capitalEvents: num(db, "SELECT COUNT(*) FROM transactions WHERE type = 'capital'"),
    openDebts: num(db, "SELECT COUNT(*) FROM debts WHERE status = 'open'"),
    paidDebts: num(db, "SELECT COUNT(*) FROM debts WHERE status = 'paid'"),
    feedbackCount: num(db, 'SELECT COUNT(*) FROM feedback'),
    avgRating: num(db, 'SELECT COALESCE(AVG(rating), 0) FROM feedback'),
    totalReceived: num(
      db,
      "SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE type = 'sale'",
    ),
    totalSpent: num(
      db,
      "SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE type = 'purchase'",
    ),
    totalCapital: num(
      db,
      "SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE type = 'capital'",
    ),
  };
}

export interface ActivityEntry {
  id: number;
  userId: number;
  type: string;
  title: string;
  amount: number | null;
  quantity: number | null;
  eventDate: string | null;
  createdAt: string;
  userName: string;
  userEmail: string | null;
  companyName: string | null;
}

interface ActivityRow {
  id: number;
  user_id: number;
  type: string;
  title: string;
  amount: number | null;
  quantity: number | null;
  event_date: string | null;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  company_name: string | null;
}

function displayName(first: string | null, last: string | null): string {
  const name = [first, last].filter(Boolean).join(' ').trim();
  return name.length > 0 ? name : 'Unknown user';
}

export function getActivity(db: Database.Database, limit: number): ActivityEntry[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.user_id, a.type, a.title, a.amount, a.quantity, a.event_date,
              a.created_at, u.first_name, u.last_name, u.email, u.company_name
       FROM activity a
       LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ?`,
    )
    .all(limit) as unknown as ActivityRow[];

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    type: row.type,
    title: row.title,
    amount: row.amount,
    quantity: row.quantity,
    eventDate: row.event_date,
    createdAt: row.created_at,
    userName: displayName(row.first_name, row.last_name),
    userEmail: row.email,
    companyName: row.company_name,
  }));
}

export interface FeedbackEntry {
  id: number;
  userId: number;
  rating: number;
  liked: string | null;
  disliked: string | null;
  suggestion: string | null;
  createdAt: string;
  userName: string;
  userEmail: string | null;
  companyName: string | null;
}

interface FeedbackRow {
  id: number;
  user_id: number;
  rating: number;
  liked: string | null;
  disliked: string | null;
  suggestion: string | null;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  company_name: string | null;
}

export function getFeedback(db: Database.Database, limit: number): FeedbackEntry[] {
  const rows = db
    .prepare(
      `SELECT f.id, f.user_id, f.rating, f.liked, f.disliked, f.suggestion, f.created_at,
              u.first_name, u.last_name, u.email, u.company_name
       FROM feedback f
       LEFT JOIN users u ON u.id = f.user_id
       ORDER BY f.created_at DESC, f.id DESC
       LIMIT ?`,
    )
    .all(limit) as unknown as FeedbackRow[];

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    rating: row.rating,
    liked: row.liked,
    disliked: row.disliked,
    suggestion: row.suggestion,
    createdAt: row.created_at,
    userName: displayName(row.first_name, row.last_name),
    userEmail: row.email,
    companyName: row.company_name,
  }));
}

export interface UserEntry {
  id: number;
  name: string;
  email: string;
  companyName: string | null;
  businessType: string | null;
  language: string | null;
  createdAt: string;
  itemCount: number;
  transactionCount: number;
  debtCount: number;
  lastActive: string | null;
}

interface UserRow {
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string;
  company_name: string | null;
  business_type: string | null;
  language: string | null;
  created_at: string;
  item_count: number;
  transaction_count: number;
  debt_count: number;
  last_active: string | null;
}

export function getUsers(db: Database.Database, limit: number): UserEntry[] {
  const rows = db
    .prepare(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.company_name,
              u.business_type, u.language, u.created_at,
              (SELECT COUNT(*) FROM items i WHERE i.user_id = u.id) AS item_count,
              (SELECT COUNT(*) FROM transactions t WHERE t.user_id = u.id) AS transaction_count,
              (SELECT COUNT(*) FROM debts d WHERE d.user_id = u.id) AS debt_count,
              (SELECT MAX(a.created_at) FROM activity a WHERE a.user_id = u.id) AS last_active
       FROM users u
       ORDER BY u.created_at DESC, u.id DESC
       LIMIT ?`,
    )
    .all(limit) as unknown as UserRow[];

  return rows.map((row) => ({
    id: row.id,
    name: displayName(row.first_name, row.last_name),
    email: row.email,
    companyName: row.company_name,
    businessType: row.business_type,
    language: row.language,
    createdAt: row.created_at,
    itemCount: row.item_count,
    transactionCount: row.transaction_count,
    debtCount: row.debt_count,
    lastActive: row.last_active,
  }));
}

export interface SeriesPoint {
  day: string;
  value: number;
  volume: number;
}

function fillDays(points: Map<string, SeriesPoint>, days: number): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    date.setUTCDate(date.getUTCDate() - i);
    const key = date.toISOString().slice(0, 10);
    out.push(points.get(key) ?? { day: key, value: 0, volume: 0 });
  }
  return out;
}

export function getSignupSeries(db: Database.Database, days: number): SeriesPoint[] {
  const rows = db
    .prepare(
      `SELECT date(created_at) AS day, COUNT(*) AS count, 0 AS volume
       FROM users
       WHERE created_at >= date('now', '-' || ? || ' days')
       GROUP BY day
       ORDER BY day`,
    )
    .all(days) as unknown as { day: string; count: number; volume: number }[];

  const map = new Map<string, SeriesPoint>();
  for (const row of rows) {
    map.set(row.day, { day: row.day, value: row.count, volume: 0 });
  }
  return fillDays(map, days);
}

export function getTransactionSeries(db: Database.Database, days: number): SeriesPoint[] {
  const rows = db
    .prepare(
      `SELECT date AS day, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS volume
       FROM transactions
       WHERE date >= date('now', '-' || ? || ' days')
       GROUP BY day
       ORDER BY day`,
    )
    .all(days) as unknown as { day: string; count: number; volume: number }[];

  const map = new Map<string, SeriesPoint>();
  for (const row of rows) {
    map.set(row.day, { day: row.day, value: row.count, volume: row.volume });
  }
  return fillDays(map, days);
}

export interface Series {
  days: number;
  signups: SeriesPoint[];
  transactions: SeriesPoint[];
}

export function getSeries(db: Database.Database, days: number): Series {
  return {
    days,
    signups: getSignupSeries(db, days),
    transactions: getTransactionSeries(db, days),
  };
}
