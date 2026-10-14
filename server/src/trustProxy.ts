// TRUST_PROXY (KZ-08). Behind a reverse proxy every request arrives from the
// proxy's address, so per-IP rate limits need Express's `trust proxy` to read
// the client address from X-Forwarded-For. Only a hop count is accepted: `true`
// (or any address list) would let a client choose its own address by sending
// the header, and a typo must not silently fall back to either.

/** More hops than any sane deployment has; larger values amount to `true`. */
export const TRUST_PROXY_MAX_HOPS = 10;

export type TrustProxyVerdict =
  | { ok: true; value: false | number }
  | { ok: false; error: string };

/**
 * Unset or empty → false (X-Forwarded-For is ignored); a whole number of hops
 * 0–10 → that number; anything else is refused with a message for the log.
 */
export function parseTrustProxy(raw: string | undefined): TrustProxyVerdict {
  const value = raw?.trim() ?? '';
  if (value === '') {
    return { ok: true, value: false };
  }
  if (/^\d{1,2}$/.test(value)) {
    const hops = Number(value);
    if (hops <= TRUST_PROXY_MAX_HOPS) {
      return { ok: true, value: hops === 0 ? false : hops };
    }
  }
  return {
    ok: false,
    error:
      `TRUST_PROXY must be the number of reverse proxies in front of the API ` +
      `(a whole number from 0 to ${TRUST_PROXY_MAX_HOPS}; 1 for a single Caddy or nginx), ` +
      `or unset when clients connect directly. Got ${JSON.stringify(value.slice(0, 40))}. ` +
      `Values such as "true" or an address list are refused because they let clients pick ` +
      `their own address for rate limiting.`,
  };
}
