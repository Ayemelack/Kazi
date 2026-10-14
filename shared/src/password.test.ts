import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { COMMON_PASSWORDS_TOP } from './commonPasswords.js';
import {
  PERSONAL_TOKEN_MIN,
  containsPersonalInfo,
  isTooCommonPassword,
  isTrivialPattern,
  personalTokens,
} from './index.js';

describe('isTrivialPattern', () => {
  for (const value of ['a', 'aaaa', '1111', 'abab', '121212', 'abcabc', 'abcd', '4321', 'qwerty', 'azerty', 'asdf', 'poiuy', 'wxcvbn', '567890']) {
    test(`${value} is a pattern`, () => assert.equal(isTrivialPattern(value), true));
  }
  for (const value of ['', 'kazi', 'awa2026', 'douala', 'qwz', 'ac', '2026']) {
    test(`${JSON.stringify(value)} is not a pattern`, () => assert.equal(isTrivialPattern(value), false));
  }
});

describe('isTooCommonPassword (top-1000 list, as in the app)', () => {
  // Every one of these passes the length, letter and digit rules.
  const REFUSED = [
    'Password123', // listed word + digits, any case
    'PASSWORD1',
    'password2026!',
    'trustno1', // listed as is
    'Passw0rd',
    'qwerty123', // keyboard walk + digits
    'Azerty2026', // French keyboard
    'abcd1234', // run + run
    'aaaa1111', // repeated + repeated
    'abcabc12', // repeated unit
    'a1234567', // one letter on a run
    '12345678ab',
    'dragon99', // listed word + digits
    '!!monkey2026',
  ];
  for (const password of REFUSED) {
    test(`refuses ${password}`, () => assert.equal(isTooCommonPassword(password), true));
  }

  const ALLOWED = ['kaziShop2026', 'Mboa-Market7', 'x7Kp9mQ2', 'Ndole4ever', 'Tr0ub4dor&3', 'z8364917'];
  for (const password of ALLOWED) {
    test(`allows ${password}`, () => assert.equal(isTooCommonPassword(password), false));
  }

  test('uses a denylist it is given instead of the built-in one', () => {
    const denylist = new Set(['kazishop']);
    assert.equal(isTooCommonPassword('KaziShop2026', { denylist }), true);
    assert.equal(isTooCommonPassword('Password123', { denylist }), false);
  });
});

describe('personal information', () => {
  const awa = { email: 'awa.ngono@market.cm', firstName: 'Awa', lastName: 'Ngono-Bella' };

  test('tokens are the email local part, the names and their parts, 4+ characters', () => {
    assert.deepEqual(personalTokens(awa).sort(), ['awa.ngono', 'bella', 'ngono', 'ngono-bella'].sort());
    assert.equal(PERSONAL_TOKEN_MIN, 4);
  });

  for (const password of ['NGONO2026x', 'myBella77', 'awa.ngono1', 'ngono-bella9']) {
    test(`refuses ${password} (case-insensitive)`, () => {
      assert.equal(containsPersonalInfo(password, awa), true);
      assert.equal(isTooCommonPassword(password, { personal: awa }), true);
    });
  }

  test('ignores parts shorter than 4 characters', () => {
    assert.equal(isTooCommonPassword('Awa2026Shop', { personal: awa }), false);
  });

  test('accented names match regardless of case', () => {
    assert.equal(containsPersonalInfo('élodie2026', { firstName: 'Élodie' }), true);
  });

  test('without personal information only the list and patterns apply', () => {
    assert.equal(isTooCommonPassword('NGONO2026x'), false);
  });
});

describe('COMMON_PASSWORDS_TOP', () => {
  test('is the first 1000 entries of the server list, lowercase and unique', () => {
    const serverList = readFileSync(new URL('../../server/assets/common-passwords.txt', import.meta.url), 'utf8')
      .split(/\r?\n/)
      .filter(line => line.length > 0 && !line.startsWith('#'));
    assert.ok(serverList.length >= 10000, `server list has ${serverList.length} entries`);
    assert.deepEqual([...COMMON_PASSWORDS_TOP], serverList.slice(0, 1000));
    assert.equal(new Set(COMMON_PASSWORDS_TOP).size, 1000);
    assert.ok(COMMON_PASSWORDS_TOP.every(entry => entry === entry.toLowerCase()));
  });
});
