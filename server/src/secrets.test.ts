import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  EXAMPLE_JWT_SECRET,
  JWT_SECRET_MIN_BYTES,
  checkJwtSecret,
  jwtSecretProblem,
} from './secrets.js';
import { boot, removeBootDir } from './testBoot.js';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STRONG = 'k'.repeat(JWT_SECRET_MIN_BYTES);
// Production also needs a way to send reset codes (KZ-06); no request is made
// at boot.
const EMAIL = {
  EMAIL_PROVIDER: 'brevo',
  EMAIL_API_KEY: 'test-key-not-real',
  EMAIL_FROM: 'no-reply@kazi.example',
};

after(removeBootDir);

describe('jwtSecretProblem', () => {
  test('accepts 32 bytes or more', () => {
    assert.equal(jwtSecretProblem(STRONG), null);
    // 16 two-byte characters are 32 bytes.
    assert.equal(jwtSecretProblem('é'.repeat(16)), null);
  });

  test('refuses missing, short and example secrets without echoing them', () => {
    assert.match(jwtSecretProblem(undefined) ?? '', /missing/);
    assert.match(jwtSecretProblem('') ?? '', /missing/);
    const short = 'x'.repeat(JWT_SECRET_MIN_BYTES - 1);
    const problem = jwtSecretProblem(short) ?? '';
    assert.match(problem, /too short \(31 bytes; at least 32/);
    assert.ok(!problem.includes(short));
    // 15 two-byte characters: 15 characters but 30 bytes.
    assert.match(jwtSecretProblem('é'.repeat(15)) ?? '', /30 bytes/);
    // The example value is 33 bytes, so the length rule alone would let it through.
    assert.ok(Buffer.byteLength(EXAMPLE_JWT_SECRET) >= JWT_SECRET_MIN_BYTES);
    assert.match(jwtSecretProblem(EXAMPLE_JWT_SECRET) ?? '', /example value/);
  });

  test('the example value matches server/.env.example', () => {
    const example = fs.readFileSync(path.join(SERVER_DIR, '.env.example'), 'utf8');
    assert.match(example, new RegExp(`^JWT_SECRET=${EXAMPLE_JWT_SECRET}\\r?$`, 'm'));
  });
});

describe('checkJwtSecret', () => {
  test('production refuses a weak secret; development only warns', () => {
    const prod = checkJwtSecret('short', 'production');
    assert.equal(prod.ok, false);
    const dev = checkJwtSecret('short', 'development');
    assert.equal(dev.ok, true);
    assert.match(dev.ok ? dev.warning ?? '' : '', /refused when NODE_ENV=production/);
    assert.deepEqual(checkJwtSecret(STRONG, 'production'), { ok: true });
  });

  test('a missing secret stops the server everywhere', () => {
    assert.equal(checkJwtSecret(undefined, 'development').ok, false);
    assert.equal(checkJwtSecret(undefined, 'production').ok, false);
  });
});

describe('boot (KZ-29)', { timeout: 120_000 }, () => {
  test('production with a short secret exits 1 with a clear message', async () => {
    const result = await boot({ NODE_ENV: 'production', JWT_SECRET: 'too-short-secret' });
    assert.equal(result.code, 1);
    assert.match(result.output, /JWT_SECRET is too short \(16 bytes; at least 32 are required\)\. Refusing to start in production\./);
    assert.match(result.output, /randomBytes\(48\)/);
    assert.ok(!result.output.includes('too-short-secret'), 'the secret is never printed');
    assert.ok(!result.output.includes('Kazi API listening'));
  });

  test('production with the .env.example value exits 1', async () => {
    const result = await boot({ NODE_ENV: 'production', JWT_SECRET: EXAMPLE_JWT_SECRET });
    assert.equal(result.code, 1);
    assert.match(result.output, /example value from \.env\.example\. Refusing to start in production/);
  });

  test('production with a strong secret starts', async () => {
    const result = await boot({ NODE_ENV: 'production', JWT_SECRET: STRONG, ...EMAIL });
    assert.equal(result.code, null, result.output);
  });

  test('development with a short secret starts with a warning', async () => {
    const result = await boot({ NODE_ENV: 'development', JWT_SECRET: 'too-short-secret' });
    assert.equal(result.code, null, result.output);
    assert.match(result.output, /WARN JWT_SECRET is too short/);
  });
});
