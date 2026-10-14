import type Database from 'better-sqlite3';
import { AppError } from '../errors.js';
import { createResetToken, hashResetToken, signAccessToken } from './jwt.js';
import {
  hashPassword,
  prepareDummyHash,
  startHashWorkers,
  verifyPassword,
} from './passwordHash.js';
import { assertPasswordNotTooCommon } from './passwordPolicy.js';
import type {
  AccountInput,
  DeleteAccountInput,
  ForgotPasswordInput,
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

export interface AuthResult {
  token: string;
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

interface ResetRow {
  user_id: number;
  expires_at: number;
  used: number;
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
    token: signAccessToken(user.id, user.token_version, requiredSecret()),
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

  return { token: signAccessToken(user.id, user.token_version, requiredSecret()), user: toPublicUser(user) };
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
  // Foreign keys cascade to password resets, items, stock movements,
  // transactions, debts, activity and feedback.
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
}

export function requestPasswordReset(
  db: Database.Database,
  input: ForgotPasswordInput,
): string | null {
  const user = db
    .prepare('SELECT id, first_name, last_name FROM users WHERE email = ?')
    .get(input.email.toLowerCase()) as
    | { id: number; first_name: string; last_name: string }
    | undefined;

  db.prepare(
    'DELETE FROM password_resets WHERE expires_at < ? OR used = 1',
  ).run(Date.now());

  const nameMatches =
    user != null &&
    input.firstName.trim().toLowerCase() === user.first_name.trim().toLowerCase() &&
    input.lastName.trim().toLowerCase() === user.last_name.trim().toLowerCase();

  if (!user || !nameMatches) {
    // Respond identically whether the account exists or the details do not
    // match, so a caller can never learn that an email is registered or which
    // detail was wrong. Knowing the email alone must never be enough to start
    // a password reset.
    return null;
  }

  const { token, expiresAt } = createResetToken();
  db.prepare(
    'INSERT INTO password_resets (token, user_id, expires_at) VALUES (?, ?, ?)',
  ).run(hashResetToken(token), user.id, expiresAt);

  // The token is handed back in the HTTP response to the verified requester
  // only. It is never logged, never sent over email and never shown to the user.
  return token;
}

export async function resetPassword(
  db: Database.Database,
  input: ResetPasswordInput,
): Promise<void> {
  const reset = db
    .prepare('SELECT * FROM password_resets WHERE token = ?')
    .get(hashResetToken(input.token)) as unknown as ResetRow | undefined;

  if (!reset || reset.used === 1) {
    throw new AppError(
      400,
      'INVALID_TOKEN',
      'This reset code is invalid. Request a new one.',
    );
  }

  if (reset.expires_at < Date.now()) {
    throw new AppError(
      400,
      'TOKEN_EXPIRED',
      'This reset code has expired. Request a new one.',
    );
  }

  const owner = selectUser(db, reset.user_id);
  if (owner) {
    assertPasswordNotTooCommon(input.password, {
      email: owner.email,
      firstName: owner.first_name,
      lastName: owner.last_name,
    });
  }

  const passwordHash = await hashPassword(input.password);
  const update = db.transaction(() => {
    // Bumping token_version invalidates every access token that was signed
    // before the reset, so a session token that leaked elsewhere cannot be
    // revived by changing the password. All other outstanding reset codes for
    // the account are purged so a previously issued code cannot be used after
    // this one succeeds. The code is claimed first: hashing is async, so a
    // second request with the same code may have used it in the meantime.
    const claimed = db
      .prepare('UPDATE password_resets SET used = 1 WHERE token = ? AND used = 0')
      .run(hashResetToken(input.token));
    if (claimed.changes !== 1) {
      throw new AppError(400, 'INVALID_TOKEN', 'This reset code is invalid. Request a new one.');
    }
    db.prepare(
      `UPDATE users
       SET password_hash = ?, token_version = token_version + 1, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(passwordHash, reset.user_id);
    db.prepare('DELETE FROM password_resets WHERE user_id = ? AND token != ?').run(
      reset.user_id,
      hashResetToken(input.token),
    );
  });

  update();
}

function requiredSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new AppError(500, 'INTERNAL', 'Server is missing the JWT secret.');
  }
  return secret;
}