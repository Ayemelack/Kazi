import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { boot, removeBootDir, startServer } from './testBoot.js';
import { TRUST_PROXY_MAX_HOPS, parseTrustProxy } from './trustProxy.js';

// KZ-08: TRUST_PROXY is a hop count or unset; nothing else boots.

const SECRET = 'k'.repeat(48);

after(removeBootDir);

describe('parseTrustProxy', () => {
  test('unset or blank means X-Forwarded-For is ignored', () => {
    for (const raw of [undefined, '', '  ']) {
      assert.deepEqual(parseTrustProxy(raw), { ok: true, value: false }, JSON.stringify(raw));
    }
  });

  test('a whole number is the hop count; 0 is the same as unset', () => {
    assert.deepEqual(parseTrustProxy('0'), { ok: true, value: false });
    assert.deepEqual(parseTrustProxy('1'), { ok: true, value: 1 });
    assert.deepEqual(parseTrustProxy(' 2 '), { ok: true, value: 2 });
    assert.deepEqual(parseTrustProxy(String(TRUST_PROXY_MAX_HOPS)), { ok: true, value: TRUST_PROXY_MAX_HOPS });
  });

  test('true, addresses, names, signs, fractions and huge counts are refused', () => {
    for (const raw of [
      'true', 'TRUE', 'false', 'yes', 'loopback', '127.0.0.1', '10.0.0.0/8', 'uniquelocal',
      '-1', '+1', '1.5', '1e1', '0x1', '11', '100', '1,2', 'one',
    ]) {
      const verdict = parseTrustProxy(raw);
      assert.equal(verdict.ok, false, raw);
      if (!verdict.ok) {
        assert.match(verdict.error, /^TRUST_PROXY must be the number of reverse proxies/);
      }
    }
  });
});

describe('boot (KZ-08)', { timeout: 240_000 }, () => {
  test('TRUST_PROXY=true refuses to start and says why', async () => {
    const result = await boot({ NODE_ENV: 'test', JWT_SECRET: SECRET, TRUST_PROXY: 'true' });
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /TRUST_PROXY must be the number of reverse proxies in front of the API/);
    assert.match(result.output, /Got "true"/);
    assert.ok(!result.output.includes('Kazi API listening'));
  });

  test('TRUST_PROXY unset boots and says X-Forwarded-For is ignored', async () => {
    const result = await boot({ NODE_ENV: 'test', JWT_SECRET: SECRET });
    assert.equal(result.code, null, result.output);
    assert.match(result.output, /Client addresses: from the connection \(TRUST_PROXY unset; X-Forwarded-For ignored\)/);
  });

  test('TRUST_PROXY=1 boots, and the real server keys limits on the forwarded address', async () => {
    const running = await startServer({ NODE_ENV: 'test', JWT_SECRET: SECRET, TRUST_PROXY: '1' });
    try {
      assert.match(running.output(), /Client addresses: from X-Forwarded-For, trusting 1 proxy hop\(s\)/);
      const signup = (from: string) =>
        fetch(`${running.baseUrl}/auth/signup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': from },
          body: '{}',
          signal: AbortSignal.timeout(20_000),
        }).then(response => response.status);
      const statuses: number[] = [];
      for (let i = 0; i < 13; i += 1) {
        statuses.push(await signup('203.0.113.50'));
      }
      assert.deepEqual(statuses, [...Array(12).fill(400), 429]);
      assert.equal(await signup('203.0.113.51'), 400);
    } finally {
      await running.stop();
    }
  });
});
