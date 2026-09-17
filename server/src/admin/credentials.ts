import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Admin credentials are intentionally isolated from the Kazi app's user system.
// They are never stored in the app database, never derived from JWT_SECRET, and
// a Kazi account token has no meaning here. This is what guarantees that no
// Kazi app user can ever authenticate against the admin dashboard.

export interface StoredCredentials {
  username: string;
  salt: string;
  hash: string;
}

export interface LoadCredentialsResult {
  credentials: StoredCredentials;
  generatedPassword?: string;
  source: 'env' | 'file' | 'generated';
}

function scrypt(password: string, salt: string): Buffer {
  return crypto.scryptSync(password, salt, 64);
}

export function verifyPassword(candidate: string, stored: StoredCredentials): boolean {
  const expected = Buffer.from(stored.hash, 'hex');
  const actual = scrypt(candidate, stored.salt);
  if (expected.length !== actual.length) {
    return false;
  }
  return crypto.timingSafeEqual(expected, actual);
}

function buildCredentials(username: string, password: string): StoredCredentials {
  const salt = crypto.randomBytes(16).toString('hex');
  return { username, salt, hash: scrypt(password, salt).toString('hex') };
}

export function loadCredentials(credentialsPath: string): LoadCredentialsResult {
  const envPassword = process.env.ADMIN_PASSWORD;
  const username = process.env.ADMIN_USERNAME?.trim() || 'admin';

  if (envPassword && envPassword.length > 0) {
    return { credentials: buildCredentials(username, envPassword), source: 'env' };
  }

  if (fs.existsSync(credentialsPath)) {
    try {
      const parsed = JSON.parse(
        fs.readFileSync(credentialsPath, 'utf8'),
      ) as Partial<StoredCredentials>;
      if (parsed.username && parsed.salt && parsed.hash) {
        return {
          credentials: {
            username: parsed.username,
            salt: parsed.salt,
            hash: parsed.hash,
          },
          source: 'file',
        };
      }
    } catch {
      // Fall through and recreate a valid credential file below.
    }
  }

  const password = crypto.randomBytes(24).toString('base64url');
  const credentials = buildCredentials(username, password);
  fs.mkdirSync(path.dirname(credentialsPath), { recursive: true });
  fs.writeFileSync(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, {
    mode: 0o600,
  });
  return { credentials, generatedPassword: password, source: 'generated' };
}
