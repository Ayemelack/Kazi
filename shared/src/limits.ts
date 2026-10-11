// Every limit the app checks before submitting and the API enforces on
// receipt (KZ-16). Both sides import these constants, so they can't drift; the
// API stays the authority and the app mirrors it so users see the error first.
//
// Text lengths count characters after trimming, except the password, which is
// counted in UTF-8 bytes because bcrypt silently ignores everything past 72.

// Account
export const PERSON_NAME_MAX = 50;
export const COMPANY_NAME_MIN = 2;
export const COMPANY_NAME_MAX = 100;
export const BUSINESS_TYPE_MAX = 60;
export const EMAIL_MAX = 254;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX_BYTES = 72;

// Items and stock
export const ITEM_NAME_MIN = 2;
export const ITEM_NAME_MAX = 100;
export const ITEM_NOTES_MAX = 500;
export const STOCK_REASON_MAX = 200;
export const QUANTITY_MAX = 1_000_000_000;
export const LOW_STOCK_THRESHOLD_MAX = 1_000_000_000;

// Transactions and debts (MONEY_MAX lives in money.ts)
export const TRANSACTION_DESCRIPTION_MAX = 200;
export const DEBT_NAME_MAX = 100;
export const DEBT_NOTE_MAX = 200;

// Feedback
export const FEEDBACK_TEXT_MAX = 1000;

// Idempotency keys (KZ-11)
export const CLIENT_OP_ID_MIN = 8;
export const CLIENT_OP_ID_MAX = 64;

// History paging: the app asks for HISTORY_PAGE_SIZE rows; the API serves at
// most ACTIVITY_PAGE_MAX, ACTIVITY_PAGE_DEFAULT when no limit is given.
export const HISTORY_PAGE_SIZE = 30;
export const ACTIVITY_PAGE_DEFAULT = 50;
export const ACTIVITY_PAGE_MAX = 200;
// SQLite rejects an OFFSET it can't store, so the API bounds it.
export const ACTIVITY_OFFSET_MAX = 1_000_000;

/**
 * UTF-8 length of a string, the unit bcrypt's 72-byte limit is measured in.
 * Written out instead of TextEncoder so it runs the same on Hermes and Node
 * without DOM types. A lone surrogate counts as 3 bytes (U+FFFD), as
 * TextEncoder and Buffer encode it.
 */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}
