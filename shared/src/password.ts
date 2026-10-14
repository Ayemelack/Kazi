import { COMMON_PASSWORDS_TOP } from './commonPasswords.js';

// Password guessability rules (KZ-05, decision D1): instead of refusing a
// password because another account uses it (which told anyone that some
// account used it), Kazi refuses passwords that are easy to guess. The API is
// the authority and passes its full 10 000-entry list; the app runs the same
// rules with the top 1000 for instant feedback.

// A name or email part shorter than this is not checked: "Awa" inside a
// password is too likely to be a coincidence.
export const PERSONAL_TOKEN_MIN = 4;

export interface PersonalInfo {
  email?: string;
  firstName?: string;
  lastName?: string;
}

export interface PasswordDenylist {
  has(value: string): boolean;
}

let topList: ReadonlySet<string> | undefined;

function defaultDenylist(): ReadonlySet<string> {
  topList ??= new Set(COMMON_PASSWORDS_TOP);
  return topList;
}

// Rows of the QWERTY, QWERTZ and AZERTY (French) layouts plus the digit row.
const KEYBOARD_ROWS = [
  '1234567890',
  'qwertyuiop',
  'qwertzuiop',
  'azertyuiop',
  'asdfghjkl',
  'qsdfghjklm',
  'zxcvbnm',
  'yxcvbnm',
  'wxcvbn',
];
const KEYBOARD_WALKS = [...KEYBOARD_ROWS, ...KEYBOARD_ROWS.map(row => [...row].reverse().join(''))];

const REPEATED_UNIT = /^(.{1,3})\1+$/su;

function isConsecutiveRun(chars: readonly string[]): boolean {
  if (chars.length < 2) {
    return false;
  }
  const step = (chars[1]?.codePointAt(0) ?? 0) - (chars[0]?.codePointAt(0) ?? 0);
  if (step !== 1 && step !== -1) {
    return false;
  }
  for (let i = 2; i < chars.length; i += 1) {
    if ((chars[i]?.codePointAt(0) ?? 0) - (chars[i - 1]?.codePointAt(0) ?? 0) !== step) {
      return false;
    }
  }
  return true;
}

/**
 * True for a lowercase string that is only a pattern: one character, a short
 * unit repeated ("aaaa", "abab", "121212"), a run ("abcd", "4321") or a
 * keyboard walk of 3+ keys ("qwerty", "azerty", "poiu").
 */
export function isTrivialPattern(value: string): boolean {
  const chars = Array.from(value);
  if (chars.length === 0) {
    return false;
  }
  if (chars.length === 1 || REPEATED_UNIT.test(value) || isConsecutiveRun(chars)) {
    return true;
  }
  return chars.length >= 3 && KEYBOARD_WALKS.some(walk => walk.includes(value));
}

/** The lowercase name and email parts a password must not contain. */
export function personalTokens(info: PersonalInfo): string[] {
  const localPart = info.email?.split('@')[0] ?? '';
  const tokens = new Set<string>();
  for (const value of [localPart, info.firstName ?? '', info.lastName ?? '']) {
    const whole = value.trim().toLowerCase();
    // "jean.paul@…" and "Jean-Paul" also yield "jean" and "paul".
    for (const token of [whole, ...whole.split(/[^\p{L}\p{N}]+/u)]) {
      if (Array.from(token).length >= PERSONAL_TOKEN_MIN) {
        tokens.add(token);
      }
    }
  }
  return [...tokens];
}

export function containsPersonalInfo(password: string, info: PersonalInfo): boolean {
  const lower = password.toLowerCase();
  return personalTokens(info).some(token => lower.includes(token));
}

export interface TooCommonOptions {
  /** Lowercase entries; defaults to the 1000 most common passwords. */
  denylist?: PasswordDenylist;
  personal?: PersonalInfo;
}

/**
 * True when a password is easy to guess: it is on the list, it is only a
 * pattern, it is a listed word or pattern with digits or symbols around it
 * ("Password123!", "qwerty2026", "abcd1234"), it is a pattern with one or two
 * letters added ("a1234567"), or it contains the user's name or email.
 * Comparisons ignore case.
 */
export function isTooCommonPassword(password: string, options: TooCommonOptions = {}): boolean {
  const denylist = options.denylist ?? defaultDenylist();
  const lower = password.toLowerCase();
  if (denylist.has(lower) || isTrivialPattern(lower)) {
    return true;
  }
  // The part between leading and trailing digits and symbols.
  const core = lower.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
  if (Array.from(core).length >= 3) {
    if (denylist.has(core) || isTrivialPattern(core)) {
      return true;
    }
  } else if (isTrivialPattern(lower.replace(/\p{L}/gu, ''))) {
    return true;
  }
  return options.personal !== undefined && containsPersonalInfo(password, options.personal);
}
