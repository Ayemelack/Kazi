import { readFileSync } from 'node:fs';
import { isTooCommonPassword, type PersonalInfo } from '@kazi/shared';
import { AppError } from '../errors.js';

// KZ-05 (decision D1): passwords that are easy to guess are refused, using
// the shared rules (patterns, personal information) with the full common-
// password list. The list lives in server/assets/ (source and licence in its
// header); this path resolves to it from src/ (tsx) and from dist/.
const LIST_FILE = new URL('../../assets/common-passwords.txt', import.meta.url);

export function loadCommonPasswords(file: URL = LIST_FILE): Set<string> {
  const entries = new Set<string>();
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.length > 0 && !line.startsWith('#')) {
      entries.add(line.toLowerCase());
    }
  }
  return entries;
}

// Read once, when the server starts; never per request.
const COMMON_PASSWORDS: ReadonlySet<string> = loadCommonPasswords();

export function commonPasswordCount(): number {
  return COMMON_PASSWORDS.size;
}

export function assertPasswordNotTooCommon(password: string, personal: PersonalInfo): void {
  if (isTooCommonPassword(password, { denylist: COMMON_PASSWORDS, personal })) {
    throw new AppError(
      400,
      'PASSWORD_TOO_COMMON',
      'This password is too easy to guess. Avoid common passwords, patterns and your name or email.',
      { field: 'password', rule: 'notAllowed' },
    );
  }
}
