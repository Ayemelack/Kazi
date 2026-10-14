// JWT_SECRET strength (KZ-29). Anyone who knows the secret can mint a session
// for any account, so production refuses to start with a weak one.

export const JWT_SECRET_MIN_BYTES = 32;

// The placeholder in server/.env.example (a test keeps the two in sync).
export const EXAMPLE_JWT_SECRET = 'change-me-to-a-long-random-string';

export const GENERATE_SECRET_HINT =
  'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"';

/** Why the secret is unacceptable, or null. Never includes the secret itself. */
export function jwtSecretProblem(secret: string | undefined): string | null {
  if (!secret) {
    return 'JWT_SECRET is missing.';
  }
  if (secret === EXAMPLE_JWT_SECRET) {
    return 'JWT_SECRET is still the example value from .env.example.';
  }
  const bytes = Buffer.byteLength(secret, 'utf8');
  if (bytes < JWT_SECRET_MIN_BYTES) {
    return `JWT_SECRET is too short (${bytes} bytes; at least ${JWT_SECRET_MIN_BYTES} are required).`;
  }
  return null;
}

export type SecretVerdict =
  | { ok: true; warning?: string }
  | { ok: false; error: string };

/**
 * A missing secret always stops the server; a weak one stops it in
 * production and is only a warning elsewhere, so local setups keep working.
 */
export function checkJwtSecret(
  secret: string | undefined,
  nodeEnv: string | undefined,
): SecretVerdict {
  const problem = jwtSecretProblem(secret);
  if (problem === null) {
    return { ok: true };
  }
  if (!secret) {
    return {
      ok: false,
      error: `${problem} Set it in the environment or .env and start the server again. ${GENERATE_SECRET_HINT}`,
    };
  }
  if (nodeEnv === 'production') {
    return {
      ok: false,
      error: `${problem} Refusing to start in production. ${GENERATE_SECRET_HINT}`,
    };
  }
  return { ok: true, warning: `${problem} This is refused when NODE_ENV=production.` };
}
