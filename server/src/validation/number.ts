import { z } from 'zod';

// z.coerce.number() is not a validator: it happily turns `true` into 1,
// `[16]` into 16 and "0x10" into 16, so a mistyped or hostile client can get
// a different number stored than the one it appeared to send. Every numeric
// schema in this API goes through this guard first: only JSON numbers and
// plain decimal strings (form-encoded and query values) survive, everything
// else becomes NaN so the wrapped zod schema rejects it with its own message.
// Money is stricter still (whole FCFA only): see money.ts.
const DECIMAL = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export function strictNumber<T extends z.ZodNumber>(
  base: T,
): z.ZodEffects<T, number, unknown> {
  return z.preprocess((value: unknown) => {
    if (value === undefined || typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string') {
      const raw = value.trim();
      return DECIMAL.test(raw) ? raw : NaN;
    }
    return NaN;
  }, base);
}
