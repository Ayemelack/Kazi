import * as Keychain from 'react-native-keychain';
import {
  LOCKOUT_MAX_MS,
  lockoutDurationFor,
  type LockMethod,
  type SecretKind,
} from './types';
import { HASH_ITERATIONS, hashSecret, randomSalt } from './hash';
import { promptBiometric } from './biometrics';

const CONFIG_SERVICE = 'com.kazi.app.lock';
const BIOMETRIC_SERVICE = 'com.kazi.app.lock.fingerprint';

export interface LockConfigRecord {
  enabled: boolean;
  method: LockMethod;
  secretKind: SecretKind;
  salt: string | null;
  hash: string | null;
  failedAttempts: number;
  lockoutUntil: number;
}

export const EMPTY_CONFIG: LockConfigRecord = {
  enabled: false,
  method: 'pin',
  secretKind: 'pin',
  salt: null,
  hash: null,
  failedAttempts: 0,
  lockoutUntil: 0,
};

function isLockMethod(value: unknown): value is LockMethod {
  return value === 'pin' || value === 'password' || value === 'fingerprint';
}

function isSecretKind(value: unknown): value is SecretKind {
  return value === 'pin' || value === 'password';
}

function normalize(raw: unknown): LockConfigRecord {
  if (!raw || typeof raw !== 'object') {
    return { ...EMPTY_CONFIG };
  }
  const data = raw as Partial<LockConfigRecord>;
  const method = isLockMethod(data.method) ? data.method : 'pin';
  const secretKind = isSecretKind(data.secretKind)
    ? data.secretKind
    : method === 'password'
    ? 'password'
    : 'pin';
  return {
    enabled: data.enabled === true,
    method,
    secretKind,
    salt: typeof data.salt === 'string' ? data.salt : null,
    hash: typeof data.hash === 'string' ? data.hash : null,
    failedAttempts:
      typeof data.failedAttempts === 'number' && data.failedAttempts > 0
        ? Math.floor(data.failedAttempts)
        : 0,
    lockoutUntil:
      typeof data.lockoutUntil === 'number' && data.lockoutUntil > 0
        ? Math.floor(data.lockoutUntil)
        : 0,
  };
}

async function writeConfig(config: LockConfigRecord): Promise<boolean> {
  try {
    const result = await Keychain.setGenericPassword('kazi-lock', JSON.stringify(config), {
      service: CONFIG_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    return result !== false;
  } catch {
    return false;
  }
}

export async function loadConfig(): Promise<LockConfigRecord> {
  try {
    const credentials = await Keychain.getGenericPassword({ service: CONFIG_SERVICE });
    if (!credentials) {
      return { ...EMPTY_CONFIG };
    }
    return normalize(JSON.parse(credentials.password));
  } catch {
    return { ...EMPTY_CONFIG };
  }
}

export async function persistConfig(config: LockConfigRecord): Promise<void> {
  await writeConfig(config);
}

async function writeBiometricKey(): Promise<boolean> {
  try {
    const result = await Keychain.setGenericPassword('kazi-lock-bio', randomSalt(32), {
      service: BIOMETRIC_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY,
    });
    return result !== false;
  } catch {
    return false;
  }
}

async function removeBiometricKey(): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: BIOMETRIC_SERVICE });
  } catch {
    // A missing biometric key is an acceptable outcome.
  }
}

export interface SecretSetup {
  method: LockMethod;
  secretKind: SecretKind;
  secret: string;
}

/**
 * Enables or updates the app lock using a PIN or password secret.
 * When `method` is `fingerprint`, the secret is kept as a fallback and a
 * biometric-protected key is registered instead.
 */
export async function configureSecret(setup: SecretSetup): Promise<boolean> {
  const current = await loadConfig();
  const salt = randomSalt();
  const hash = hashSecret(setup.secret, salt);
  const next: LockConfigRecord = {
    ...current,
    enabled: true,
    method: setup.method,
    secretKind: setup.secretKind,
    salt,
    hash,
    failedAttempts: 0,
    lockoutUntil: 0,
  };
  if (setup.method === 'fingerprint') {
    const bioOk = await writeBiometricKey();
    if (!bioOk) {
      return false;
    }
    return writeConfig(next);
  }
  const saved = await writeConfig(next);
  if (!saved) {
    return false;
  }
  await removeBiometricKey();
  return true;
}

/**
 * Enables the app lock using fingerprint authentication only.
 *
 * No user-supplied PIN or password is required: a random secret is kept behind
 * the device's biometric protection and released only through the OS prompt.
 * The lock stays disabled if biometrics are unavailable or the confirmation
 * prompt is not approved.
 */
export async function configureFingerprint(): Promise<boolean> {
  const supported = await Keychain.getSupportedBiometryType();
  if (!supported) {
    return false;
  }
  const current = await loadConfig();
  const bioOk = await writeBiometricKey();
  if (!bioOk) {
    return false;
  }
  const confirmed = await promptBiometric('Confirm fingerprint');
  if (!confirmed) {
    await removeBiometricKey();
    return false;
  }
  return writeConfig({
    ...current,
    enabled: true,
    method: 'fingerprint',
    salt: null,
    hash: null,
    failedAttempts: 0,
    lockoutUntil: 0,
  });
}

export async function disableLock(): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: CONFIG_SERVICE });
  } catch {
    // Ignore.
  }
  await removeBiometricKey();
}

export function verifySecret(config: LockConfigRecord, secret: string): boolean {
  if (!config.salt || !config.hash) {
    return false;
  }
  return hashSecret(secret, config.salt, HASH_ITERATIONS) === config.hash;
}

export function registerFailedAttempt(config: LockConfigRecord): LockConfigRecord {
  const failedAttempts = config.failedAttempts + 1;
  return {
    ...config,
    failedAttempts,
    lockoutUntil:
      lockoutDurationFor(failedAttempts) > 0
        ? Date.now() + Math.min(lockoutDurationFor(failedAttempts), LOCKOUT_MAX_MS)
        : 0,
  };
}

export function lockoutRemainingMs(config: LockConfigRecord): number {
  if (!config.lockoutUntil) {
    return 0;
  }
  return Math.max(0, config.lockoutUntil - Date.now());
}
