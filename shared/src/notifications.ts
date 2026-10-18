// The push payload contract between the API and the app (the shared half of
// KZ-02/KZ-03). The API sends data-only FCM messages; the app renders them in
// every app state (foreground, background, terminated, locked screen) and
// maps `type` to the screen a tap opens.
//
// FCM delivers every data value as a string, so the wire form is strings
// only. Everything here is pure TypeScript: no Node or React Native APIs.

/** Android channel every Kazi push is delivered on. */
export const KAZI_PUSH_CHANNEL_ID = 'kazi';

/** Machine-readable kind of push; the app maps each one to a screen. */
export const PUSH_TYPE_LOW_STOCK = 'low_stock';

export type PushType = typeof PUSH_TYPE_LOW_STOCK;

const PUSH_TYPES: readonly string[] = [PUSH_TYPE_LOW_STOCK];

/** Per-type fields a sender attaches on top of the always-present ones. */
export interface PushDataExtras {
  type?: PushType;
  /** low_stock: the item that crossed its threshold. */
  itemId?: string;
}

/** What the app needs from a validated push. */
export interface ParsedPush {
  title: string;
  body: string;
  /** null when the push carries no (or an unknown) type: display only. */
  type: PushType | null;
  /** The record the push is about, when it names one. */
  itemId: number | null;
}

/** The data extras for a low-stock alert about one item. */
export function lowStockPushData(itemId: number): PushDataExtras {
  return { type: PUSH_TYPE_LOW_STOCK, itemId: String(itemId) };
}

/**
 * Validates the FCM data map of a Kazi push. Returns null when the message is
 * not a push this app can display (not an object, or empty title/body). An
 * unknown or missing `type` still parses: it displays, it just has no screen
 * to open. An unparseable `itemId` degrades to null rather than failing the
 * whole push.
 */
export function parsePushData(data: unknown): ParsedPush | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const fields = data as Record<string, unknown>;
  const title = typeof fields.title === 'string' ? fields.title.trim() : '';
  const body = typeof fields.body === 'string' ? fields.body.trim() : '';
  if (!title || !body) {
    return null;
  }
  const rawType = fields.type;
  const type =
    typeof rawType === 'string' && PUSH_TYPES.includes(rawType) ? (rawType as PushType) : null;
  return { title, body, type, itemId: parseItemId(fields.itemId) };
}

function parseItemId(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
