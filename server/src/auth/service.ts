import type Database from 'better-sqlite3';
import { RESET_CODE_MAX_ATTEMPTS, isAppLanguage, type AppLanguage } from '@kazi/shared';
import { AppError } from '../errors.js';
import { log } from '../log.js';
import { deliveryFailureReason, type ResetCodeSender } from './delivery.js';
import { accessTokenSecret } from './jwt.js';
import { deleteDeadSessions, startSession, type SessionTokens } from './session.js';
import {
  hashPassword,
  prepareDummyHash,
  startHashWorkers,
  verifyPassword,
} from './passwordHash.js';
import { assertPasswordNotTooCommon } from './passwordPolicy.js';
import {
  NO_CODE_HASH,
  RESET_CODE_TTL_MS,
  generateResetCode,
  hashResetCode,
  resetCodeMatches,
} from './resetCode.js';
import type {
  AccountInput,
  DeleteAccountInput,
  LanguageInput,
  LoginInput,
  ProfileInput,
  ResetPasswordInput,
  SignupInput,
} from './validation.js';

export interface PublicUser {
  id: number;
  firstName: string;
  lastName: string;
  companyName: string;
  businessType: string;
  hasBusiness: boolean;
  email: string;
  language: string;
}

export interface AuthResult extends SessionTokens {
  user: PublicUser;
}

interface UserRow {
  id: number;
  first_name: string;
  last_name: string;
  company_name: string;
  business_type: string;
  email: string;
  password_hash: string;
  language: string;
  token_version: number;
}

// Started when the server loads this module, so neither the first burst of
// logins nor the first unknown-email login pays for setting them up.
startHashWorkers();
void prepareDummyHash();

function invalidCredentials(): AppError {
  return new AppError(401, 'INVALID_CREDENTIALS', 'The email or password is incorrect.');
}

function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    companyName: row.company_name,
    businessType: row.business_type,
    hasBusiness: row.company_name.trim().length > 0,
    email: row.email,
    language: row.language,
  };
}

function selectUser(db: Database.Database, userId: number): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as
    | UserRow
    | undefined;
}

// Detects SQLite's unique-constraint violation so a racing duplicate signup
// returns a clean 409 instead of surfacing an internal database error.
function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}

export async function signUp(db: Database.Database, input: SignupInput): Promise<AuthResult> {
  assertPasswordNotTooCommon(input.password, input);

  const existing = db
    .prepare('SELECT id FROM users WHERE email = ?')
    .get(input.email.toLowerCase()) as { id: number } | undefined;

  if (existing) {
    throw new AppError(
      409,
      'EMAIL_IN_USE',
      'An account with this email already exists. Try signing in instead.',
    );
  }

  const passwordHash = await hashPassword(input.password);

  let userId: number;
  try {
    const result = db
      .prepare(
        `INSERT INTO users (first_name, last_name, company_name, email, password_hash)
         VALUES (?, ?, '', ?, ?)`,
      )
      .run(input.firstName, input.lastName, input.email.toLowerCase(), passwordHash);
    userId = Number(result.lastInsertRowid);
  } catch (err) {
    // Safety net for the email UNIQUE constraint. The pre-check above covers
    // the normal path; this catches a signup for the same email that finished
    // while this one was hashing, and returns a clean conflict instead of
    // leaking a database error to the caller.
    if (isUniqueConstraintViolation(err)) {
      throw new AppError(
        409,
        'EMAIL_IN_USE',
        'An account with this email already exists. Try signing in instead.',
      );
    }
    throw err;
  }

  const user = selectUser(db, userId) as unknown as UserRow;

  return {
    ...startSession(db, user),
    user: toPublicUser(user),
  };
}

export async function logIn(db: Database.Database, input: LoginInput): Promise<AuthResult> {
  const user = db
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(input.email.toLowerCase()) as unknown as UserRow | undefined;

  // An unknown email still costs one bcrypt compare, so the response time
  // does not reveal whether the account exists (KZ-21).
  const matches = await verifyPassword(
    input.password,
    user ? user.password_hash : await prepareDummyHash(),
  );
  if (!user || !matches) {
    throw invalidCredentials();
  }

  // Housekeeping: sessions that can no longer be used.
  deleteDeadSessions(db);

  return { ...startSession(db, user), user: toPublicUser(user) };
}

export function findUserById(db: Database.Database, userId: number): PublicUser | null {
  const row = selectUser(db, userId);
  return row ? toPublicUser(row) : null;
}

export function updateProfile(
  db: Database.Database,
  userId: number,
  input: ProfileInput,
): PublicUser {
  const row = selectUser(db, userId);
  if (!row) {
    throw new AppError(404, 'NOT_FOUND', 'Account not found.');
  }

  db.prepare(
    `UPDATE users
     SET company_name = ?, business_type = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(input.companyName, input.businessType, userId);

  return toPublicUser(selectUser(db, userId) as unknown as UserRow);
}

export function updateAccountNames(
  db: Database.Database,
  userId: number,
  input: AccountInput,
): PublicUser {
  const row = selectUser(db, userId);
  if (!row) {
    throw new AppError(404, 'NOT_FOUND', 'Account not found.');
  }

  const firstName = input.firstName ?? row.first_name;
  const lastName = input.lastName ?? row.last_name;

  db.prepare(
    `UPDATE users SET first_name = ?, last_name = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(firstName, lastName, userId);

  return toPublicUser(selectUser(db, userId) as unknown as UserRow);
}

export function updateLanguage(
  db: Database.Database,
  userId: number,
  input: LanguageInput,
): PublicUser {
  const result = db
    .prepare(`UPDATE users SET language = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(input.language, userId);
  if (result.changes === 0) {
    throw new AppError(404, 'NOT_FOUND', 'Account not found.');
  }
  return toPublicUser(selectUser(db, userId) as unknown as UserRow);
}

// Deleting the account needs the password (KZ-20), so a phone left unlocked
// or a stolen session token cannot erase the business's records.
export async function deleteAccount(
  db: Database.Database,
  userId: number,
  input: DeleteAccountInput,
): Promise<void> {
  const row = selectUser(db, userId);
  if (!row) {
    throw new AppError(404, 'NOT_FOUND', 'Account not found.');
  }
  if (!(await verifyPassword(input.password, row.password_hash))) {
    throw invalidCredentials();
  }
  // Foreign keys cascade to sessions, reset codes, items, stock movements,
  // transactions, debts, activity and feedback.
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
}

// ── Password reset by emailed code (KZ-06) ──

export interface IssuedResetCode {
  userId: number;
  email: string;
  language: AppLanguage;
  code: string;
}

/**
 * Creates a reset code for the account with this email, replacing any code it
 * already had, or returns null when no account has this email. Only the code's
 * HMAC is stored.
 */
export function issueResetCode(db: Database.Database, email: string): IssuedResetCode | null {
  const secret = accessTokenSecret();
  const now = Date.now();
  const issue = db.transaction((): IssuedResetCode | null => {
    // Housekeeping: codes that can no longer be used.
    db.prepare('DELETE FROM password_resets WHERE expires_at <= ? OR used = 1').run(now);

    const user = db
      .prepare('SELECT id, email, language FROM users WHERE email = ?')
      .get(email.toLowerCase()) as { id: number; email: string; language: string } | undefined;
    if (!user) {
      return null;
    }
    // A new code invalidates every older one for this account.
    db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id);
    const code = generateResetCode();
    db.prepare(
      'INSERT INTO password_resets (user_id, code_hash, expires_at) VALUES (?, ?, ?)',
    ).run(user.id, hashResetCode(user.id, code, secret), now + RESET_CODE_TTL_MS);
    return {
      userId: user.id,
      email: user.email,
      language: isAppLanguage(user.language) ? user.language : 'en',
      code,
    };
  });
  return issue();
}

/**
 * Issues a code and hands it to the sender. Resolves with the code (null when
 * the email has no account or the code couldn't be created) and never
 * rejects: it usually runs after the response has gone, so failures are only
 * logged, with the account id and a reason but never the address or the code.
 */
export async function sendResetCode(
  db: Database.Database,
  email: string,
  sender: ResetCodeSender,
): Promise<string | null> {
  let issued: IssuedResetCode | null;
  try {
    issued = issueResetCode(db, email);
  } catch (err) {
    log.error(`Password reset code could not be created: ${err instanceof Error ? err.message : 'unknown error'}`);
    return null;
  }
  if (!issued) {
    return null;
  }
  try {
    await sender.send(issued.email, issued.code, issued.language);
  } catch (err) {
    log.warn(`Password reset code for user ${issued.userId} was not delivered: ${deliveryFailureReason(err)}`);
  }
  return issued.code;
}

function invalidResetCode(): AppError {
  return new AppError(
    400,
    'RESET_CODE_INVALID',
    'This code is wrong or no longer valid. Check it or request a new one.',
  );
}

export async function resetPassword(
  db: Database.Database,
  input: ResetPasswordInput,
): Promise<void> {
  const secret = accessTokenSecret();
  const email = input.email.toLowerCase();

  // The newest code that can still be used: not used, not expired, fewer than
  // RESET_CODE_MAX_ATTEMPTS wrong tries. Codes are checked before anything
  // about the account (such as its names in the password policy) can show, so
  // an unknown email, a missing code and a wrong code all answer alike.
  const candidate = db
    .prepare(
      `SELECT r.id, r.user_id, r.code_hash
       FROM password_resets r
       JOIN users u ON u.id = r.user_id
       WHERE u.email = ? AND r.used = 0 AND r.expires_at > ? AND r.attempts < ?
       ORDER BY r.id DESC
       LIMIT 1`,
    )
    .get(email, Date.now(), RESET_CODE_MAX_ATTEMPTS) as
    | { id: number; user_id: number; code_hash: string }
    | undefined;

  // Compared even when there is no code, so both paths do the same work.
  const matches = resetCodeMatches(
    candidate?.user_id ?? 0,
    input.code,
    candidate?.code_hash ?? NO_CODE_HASH,
    secret,
  );
  if (!candidate || !matches) {
    if (candidate) {
      // The fifth wrong try uses the code up for good.
      db.prepare('UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?').run(
        candidate.id,
      );
    }
    throw invalidResetCode();
  }

  const owner = selectUser(db, candidate.user_id);
  if (!owner) {
    throw invalidResetCode();
  }
  // A refused password leaves the code usable: it was the right code.
  assertPasswordNotTooCommon(input.password, {
    email: owner.email,
    firstName: owner.first_name,
    lastName: owner.last_name,
  });

  const passwordHash = await hashPassword(input.password);
  const update = db.transaction(() => {
    // Hashing is async, so another request may have used this code, or a new
    // code may have replaced it, in the meantime: claim it first.
    const claimed = db
      .prepare('UPDATE password_resets SET used = 1 WHERE id = ? AND used = 0')
      .run(candidate.id);
    if (claimed.changes !== 1) {
      throw invalidResetCode();
    }
    // Bumping token_version invalidates every session token signed before the
    // reset, so a leaked token cannot outlive the password change; deleting
    // the session rows also kills their refresh tokens.
    db.prepare(
      `UPDATE users
       SET password_hash = ?, token_version = token_version + 1, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(passwordHash, candidate.user_id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(candidate.user_id);
    db.prepare('DELETE FROM password_resets WHERE user_id = ? AND id != ?').run(
      candidate.user_id,
      candidate.id,
    );
  });

  update();
}
