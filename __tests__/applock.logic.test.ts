import * as Keychain from 'react-native-keychain';
import { constantTimeEqual, hashSecret, randomSalt, sha256Hex } from '../src/applock/hash';
import {
  LOCKOUT_BASE_MS,
  LOCKOUT_MAX_MS,
  isValidAppLockPassword,
  isValidPin,
  lockoutDurationFor,
} from '../src/applock/types';
import {
  configureFingerprint,
  configureSecret,
  disableLock,
  loadConfig,
  registerFailedAttempt,
  verifySecret,
  type LockConfigRecord,
} from '../src/applock/storage';

const CONFIG_SERVICE = 'com.kazi.app.lock';
const BIOMETRIC_SERVICE = 'com.kazi.app.lock.fingerprint';

beforeEach(async () => {
  jest.clearAllMocks();
  await Keychain.resetGenericPassword({ service: CONFIG_SERVICE });
  await Keychain.resetGenericPassword({ service: BIOMETRIC_SERVICE });
});

describe('sha256Hex', () => {
  it('hashes known vectors', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('hashSecret', () => {
  it('is deterministic for the same salt and secret', () => {
    expect(hashSecret('1234', 'salt', 50)).toBe(hashSecret('1234', 'salt', 50));
  });

  it('changes when the salt changes', () => {
    expect(hashSecret('1234', 'salt-a', 50)).not.toBe(hashSecret('1234', 'salt-b', 50));
  });
});

describe('randomSalt', () => {
  it('draws bytes from the platform CSPRNG, not Math.random', () => {
    const source = (globalThis as unknown as {
      crypto: { getRandomValues: (array: Uint8Array) => Uint8Array };
    }).crypto;
    const getRandomValues = jest.spyOn(source, 'getRandomValues');
    const random = jest.spyOn(Math, 'random');

    const salt = randomSalt(16);

    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(getRandomValues).toHaveBeenCalledTimes(1);
    expect(getRandomValues.mock.calls[0][0]).toBeInstanceOf(Uint8Array);
    expect((getRandomValues.mock.calls[0][0] as Uint8Array).length).toBe(16);
    expect(random).not.toHaveBeenCalled();

    random.mockRestore();
    getRandomValues.mockRestore();
  });

  it('does not repeat a salt across calls', () => {
    expect(randomSalt()).not.toBe(randomSalt());
  });
});

describe('constantTimeEqual', () => {
  it('compares equal and unequal strings', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('validators', () => {
  it('accepts 4 to 6 digit PINs only', () => {
    expect(isValidPin('1234')).toBe(true);
    expect(isValidPin('123456')).toBe(true);
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('1234567')).toBe(false);
    expect(isValidPin('12a4')).toBe(false);
  });

  it('requires passwords of at least 6 characters', () => {
    expect(isValidAppLockPassword('secret')).toBe(true);
    expect(isValidAppLockPassword('short')).toBe(false);
  });
});

describe('lockoutDurationFor', () => {
  it('starts after the max attempts threshold', () => {
    expect(lockoutDurationFor(4)).toBe(0);
    expect(lockoutDurationFor(5)).toBe(LOCKOUT_BASE_MS);
    expect(lockoutDurationFor(6)).toBe(LOCKOUT_BASE_MS * 2);
  });

  it('caps the lockout duration', () => {
    expect(lockoutDurationFor(30)).toBe(LOCKOUT_MAX_MS);
  });
});

describe('storage', () => {
  it('stores and verifies a PIN secret', async () => {
    const ok = await configureSecret({ method: 'pin', secretKind: 'pin', secret: '1234' });
    expect(ok).toBe(true);

    const config = await loadConfig();
    expect(config.enabled).toBe(true);
    expect(config.method).toBe('pin');
    expect(config.secretKind).toBe('pin');
    expect(config.salt).toBeTruthy();
    expect(config.hash).toBeTruthy();
    expect(verifySecret(config, '1234')).toBe(true);
    expect(verifySecret(config, '0000')).toBe(false);
  });

  it('keeps a fallback secret when fingerprint is selected', async () => {
    const ok = await configureSecret({
      method: 'fingerprint',
      secretKind: 'password',
      secret: 'secret1',
    });
    expect(ok).toBe(true);
    expect((Keychain.getGenericPassword as jest.Mock)).toHaveBeenCalled();

    const config = await loadConfig();
    expect(config.method).toBe('fingerprint');
    expect(config.secretKind).toBe('password');
    expect(verifySecret(config, 'secret1')).toBe(true);
  });

  it('does not enable the lock when the fingerprint key cannot be stored', async () => {
    (Keychain.setGenericPassword as jest.Mock).mockResolvedValueOnce(false);

    const ok = await configureSecret({
      method: 'fingerprint',
      secretKind: 'pin',
      secret: '1234',
    });

    expect(ok).toBe(false);
    expect((await loadConfig()).enabled).toBe(false);
  });

  it('enables fingerprint-only locks without a fallback secret', async () => {
    (Keychain.getSupportedBiometryType as jest.Mock).mockResolvedValueOnce('Fingerprint');

    const ok = await configureFingerprint();
    expect(ok).toBe(true);

    const config = await loadConfig();
    expect(config.enabled).toBe(true);
    expect(config.method).toBe('fingerprint');
    expect(config.salt).toBeNull();
    expect(config.hash).toBeNull();
  });

  it('does not enable a fingerprint-only lock when biometrics are unavailable', async () => {
    (Keychain.getSupportedBiometryType as jest.Mock).mockResolvedValueOnce(null);

    const ok = await configureFingerprint();
    expect(ok).toBe(false);
    expect((await loadConfig()).enabled).toBe(false);
  });

  it('does not enable a fingerprint-only lock when confirmation fails', async () => {
    (Keychain.getSupportedBiometryType as jest.Mock).mockResolvedValueOnce('Fingerprint');
    (Keychain.setGenericPassword as jest.Mock).mockResolvedValueOnce({
      service: BIOMETRIC_SERVICE,
    });

    const ok = await configureFingerprint();
    expect(ok).toBe(false);
    expect((await loadConfig()).enabled).toBe(false);
  });

  it('disables the lock and clears stored secrets', async () => {
    await configureSecret({ method: 'pin', secretKind: 'pin', secret: '1234' });
    await disableLock();

    const config = await loadConfig();
    expect(config.enabled).toBe(false);
    expect(config.hash).toBeNull();
  });

  it('starts a lockout after enough failed attempts', () => {
    const base: LockConfigRecord = {
      enabled: true,
      method: 'pin',
      secretKind: 'pin',
      salt: 'salt',
      hash: 'hash',
      failedAttempts: 0,
      lockoutUntil: 0,
    };

    let config = base;
    for (let i = 0; i < 4; i += 1) {
      config = registerFailedAttempt(config);
    }
    expect(config.lockoutUntil).toBe(0);

    config = registerFailedAttempt(config);
    expect(config.failedAttempts).toBe(5);
    expect(config.lockoutUntil).toBeGreaterThan(Date.now());
  });
});
