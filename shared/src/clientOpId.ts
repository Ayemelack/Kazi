// KZ-11: the idempotency key a form sends with a write ("clientOpId"). The API
// runs a write once per (user, clientOpId) and answers a repeat with the
// stored response, so a retry after a lost response never duplicates a sale.
//
// It is an idempotency key, not a secret: it only has to be unique among one
// user's writes, and the server scopes it by user_id, so another account can
// never replay or block it. Math.random is therefore enough (and is the only
// randomness this package may use: no Node or React Native APIs here).
//
// Layout, all lowercase base36: 9 characters of the millisecond clock, 12
// random characters, then 4 characters of a module counter so two ids made in
// the same millisecond by this app never collide even if the random parts did.
// 25 characters in all, inside CLIENT_OP_ID_MIN..CLIENT_OP_ID_MAX.

export const CLIENT_OP_ID_LENGTH = 25;

const COUNTER_SPAN = 36 ** 4;
const RANDOM_SPAN = 36 ** 6;

let counter = 0;

function base36(value: number, width: number): string {
  return value.toString(36).padStart(width, '0').slice(-width);
}

function randomPart(): string {
  return base36(Math.floor(Math.random() * RANDOM_SPAN), 6);
}

export function newClientOpId(now: number = Date.now()): string {
  counter = (counter + 1) % COUNTER_SPAN;
  return base36(Math.max(0, Math.floor(now)), 9) + randomPart() + randomPart() + base36(counter, 4);
}
