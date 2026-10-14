/**
 * Parses a Cookie header into name → value. A value that is not valid
 * percent-encoding (for example `%E0%A4%A`) makes decodeURIComponent throw;
 * such a cookie is ignored, so a malformed or hostile cookie is treated as
 * absent (401) instead of failing the request (500) (KZ-27).
 */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) {
    return out;
  }
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) {
      continue;
    }
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) {
      continue;
    }
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      // Malformed percent-encoding: skip this cookie only.
    }
  }
  return out;
}
