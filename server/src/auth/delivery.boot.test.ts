import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { boot, removeBootDir, startServer } from '../testBoot.js';
import { RESET_REQUESTED } from './routes.js';

// KZ-06 at the real entry point: the server refuses to start in any setup
// that could leak a reset code or could not deliver one, and a production
// server never puts a code in a response.

const SECRET = 'k'.repeat(48);
const EMAIL = {
  EMAIL_PROVIDER: 'brevo',
  EMAIL_API_KEY: 'test-key-not-real',
  EMAIL_FROM: 'no-reply@kazi.example',
};

after(removeBootDir);

describe('boot (KZ-06)', { timeout: 240_000 }, () => {
  test('production without an email sender exits 1', async () => {
    const result = await boot({ NODE_ENV: 'production', JWT_SECRET: SECRET });
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /No way to send password reset codes: set EMAIL_PROVIDER, EMAIL_API_KEY and EMAIL_FROM/);
    assert.match(result.output, /Refusing to start in production\./);
  });

  test('production with ALLOW_DEV_RESET_CODE=1 exits 1, even with email configured', async () => {
    const result = await boot({ NODE_ENV: 'production', JWT_SECRET: SECRET, ALLOW_DEV_RESET_CODE: '1', ...EMAIL });
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /ALLOW_DEV_RESET_CODE=1 returns reset codes in HTTP responses/);
    assert.ok(!result.output.includes('test-key-not-real'), 'the API key is never printed');
  });

  test('a server with no NODE_ENV and no email sender exits 1 and says how to run locally', async () => {
    const result = await boot({ JWT_SECRET: SECRET });
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /set NODE_ENV=development instead/);
  });

  test('development prints codes to the console and may enable the shortcut', async () => {
    const result = await boot({ NODE_ENV: 'development', JWT_SECRET: SECRET, ALLOW_DEV_RESET_CODE: '1' });
    assert.equal(result.code, null, result.output);
    assert.match(result.output, /Password reset codes go to the server console \(development only\)/);
    assert.match(result.output, /WARN ALLOW_DEV_RESET_CODE=1: forgot-password also returns the code/);
  });

  test('a production server answers 202 with no code and logs no address or code', async () => {
    // The provider is unreachable (nothing listens on port 9), so delivery
    // fails after the response, the way an outage would.
    const running = await startServer({
      NODE_ENV: 'production',
      JWT_SECRET: SECRET,
      EMAIL_PROVIDER: 'http',
      EMAIL_API_KEY: 'test-key-not-real',
      EMAIL_FROM: 'no-reply@kazi.example',
      EMAIL_API_URL: 'https://127.0.0.1:9/send',
    });
    try {
      assert.match(running.output(), /Password reset codes go to email \(http\)/);
      const post = async (path: string, body: unknown) => {
        const response = await fetch(`${running.baseUrl}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        return { status: response.status, text: await response.text() };
      };
      const signup = await post('/auth/signup', {
        firstName: 'Ngum',
        lastName: 'Achu',
        email: 'prod.owner@market.cm',
        password: 'mboaLedger2026',
      });
      assert.equal(signup.status, 201, signup.text);

      const known = await post('/auth/forgot-password', { email: 'prod.owner@market.cm' });
      const unknown = await post('/auth/forgot-password', { email: 'prod.nobody@market.cm' });
      assert.equal(known.status, 202);
      assert.equal(known.text, JSON.stringify(RESET_REQUESTED));
      assert.equal(unknown.text, known.text);

      const deadline = Date.now() + 30_000;
      while (!/was not delivered: http could not be reached/.test(running.output())) {
        assert.ok(Date.now() < deadline, running.output());
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      const log = running.output();
      assert.ok(!log.includes('prod.owner'), 'no address in the log');
      assert.ok(!log.includes('prod.nobody'), 'no address in the log');
      assert.ok(!log.includes('test-key-not-real'), 'no API key in the log');
      // The code itself is unknown here; no six-digit run may appear at all
      // (outside the database line, whose temporary folder name is random).
      const lines = log.split('\n').filter(line => !line.includes('Kazi API database:'));
      assert.doesNotMatch(lines.join('\n'), /[0-9]{6}/);
    } finally {
      await running.stop();
    }
  });
});
