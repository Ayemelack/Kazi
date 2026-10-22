import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { type LockMethod, type SecretKind, type UnlockResult } from './types';
import { HASH_ITERATIONS, constantTimeEqual, hashSecret } from './hash';
import {
  configureFingerprint,
  configureSecret,
  disableLock,
  loadConfig,
  persistConfig,
  registerFailedAttempt,
  type LockConfigRecord,
} from './storage';
import { getBiometryType, promptBiometric, type BiometryKind } from './biometrics';

export interface AppLockContextValue {
  ready: boolean;
  enabled: boolean;
  method: LockMethod;
  secretKind: SecretKind;
  hasFallback: boolean;
  locked: boolean;
  biometry: BiometryKind | null;
  lockoutUntil: number;
  lock: () => void;
  unlockWithSecret: (secret: string) => Promise<UnlockResult>;
  unlockWithBiometrics: () => Promise<UnlockResult>;
  enableWithSecret: (method: 'pin' | 'password', secret: string) => Promise<boolean>;
  enableWithFingerprint: () => Promise<boolean>;
  changeSecret: (secretKind: SecretKind, secret: string) => Promise<boolean>;
  disable: () => Promise<void>;
}

const AppLockContext = createContext<AppLockContextValue | null>(null);

const EMPTY: LockConfigRecord = {
  enabled: false,
  method: 'pin',
  secretKind: 'pin',
  salt: null,
  hash: null,
  failedAttempts: 0,
  lockoutUntil: 0,
};

export function useAppLock(): AppLockContextValue {
  const context = useContext(AppLockContext);
  if (!context) {
    throw new Error('useAppLock must be used within an AppLockProvider');
  }
  return context;
}

export function AppLockProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<LockConfigRecord>(EMPTY);
  const [ready, setReady] = useState(false);
  const [locked, setLocked] = useState(false);
  const [biometry, setBiometry] = useState<BiometryKind | null>(null);

  const configRef = useRef(config);
  configRef.current = config;
  const authenticatingRef = useRef(false);
  const appStateRef = useRef<AppStateStatus>(
    (AppState.currentState as AppStateStatus | null | undefined) ?? 'active',
  );

  const applyConfig = useCallback(async () => {
    const loaded = await loadConfig();
    setConfig(loaded);
    return loaded;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [loaded, supported] = await Promise.all([loadConfig(), getBiometryType()]);
      if (cancelled) {
        return;
      }
      setConfig(loaded);
      setBiometry(supported);
      if (loaded.enabled) {
        setLocked(true);
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => {
      const previous = appStateRef.current;
      appStateRef.current = next;
      if (
        previous === 'active' &&
        next === 'background' &&
        configRef.current.enabled &&
        !authenticatingRef.current
      ) {
        setLocked(true);
      }
    });
    return () => subscription.remove();
  }, []);

  const persist = useCallback(async (next: LockConfigRecord) => {
    setConfig(next);
    await persistConfig(next);
  }, []);

  const lock = useCallback(() => {
    if (configRef.current.enabled) {
      setLocked(true);
    }
  }, []);

  const unlockWithSecret = useCallback(
    async (secret: string): Promise<UnlockResult> => {
      const current = configRef.current;
      if (!current.enabled || !current.salt || !current.hash) {
        setLocked(false);
        return 'ok';
      }
      if (current.lockoutUntil > Date.now()) {
        return 'locked';
      }
      authenticatingRef.current = true;
      try {
        const candidate = hashSecret(secret, current.salt, HASH_ITERATIONS);
        if (constantTimeEqual(candidate, current.hash)) {
          await persist({ ...current, failedAttempts: 0, lockoutUntil: 0 });
          setLocked(false);
          return 'ok';
        }
        const failed = registerFailedAttempt(current);
        await persist(failed);
        return failed.lockoutUntil > Date.now() ? 'locked' : 'invalid';
      } finally {
        authenticatingRef.current = false;
      }
    },
    [persist],
  );

  const unlockWithBiometrics = useCallback(async (): Promise<UnlockResult> => {
    const current = configRef.current;
    if (!current.enabled) {
      setLocked(false);
      return 'ok';
    }
    if (!biometry) {
      return 'unavailable';
    }
    authenticatingRef.current = true;
    try {
      const success = await promptBiometric('Unlock Kazi');
      if (success) {
        await persist({ ...current, failedAttempts: 0, lockoutUntil: 0 });
        setLocked(false);
        return 'ok';
      }
      return 'cancelled';
    } finally {
      authenticatingRef.current = false;
    }
  }, [biometry, persist]);

  const enableWithSecret = useCallback(
    async (method: 'pin' | 'password', secret: string): Promise<boolean> => {
      const ok = await configureSecret({ method, secretKind: method, secret });
      if (ok) {
        await applyConfig();
      }
      return ok;
    },
    [applyConfig],
  );

  const enableWithFingerprint = useCallback(async (): Promise<boolean> => {
    const ok = await configureFingerprint();
    if (ok) {
      await applyConfig();
    }
    return ok;
  }, [applyConfig]);

  const changeSecret = useCallback(
    async (secretKind: SecretKind, secret: string): Promise<boolean> => {
      const current = configRef.current;
      const method = current.method === 'fingerprint' ? 'fingerprint' : current.method;
      const ok = await configureSecret({ method, secretKind, secret });
      if (ok) {
        await applyConfig();
      }
      return ok;
    },
    [applyConfig],
  );

  const disable = useCallback(async () => {
    await disableLock();
    setConfig({ ...EMPTY });
    setLocked(false);
  }, []);

  const value = useMemo<AppLockContextValue>(
    () => ({
      ready,
      enabled: config.enabled,
      method: config.method,
      secretKind: config.secretKind,
      hasFallback: config.hash !== null,
      locked,
      biometry,
      lockoutUntil: config.lockoutUntil,
      lock,
      unlockWithSecret,
      unlockWithBiometrics,
      enableWithSecret,
      enableWithFingerprint,
      changeSecret,
      disable,
    }),
    [
      ready,
      config.enabled,
      config.method,
      config.secretKind,
      config.hash,
      config.lockoutUntil,
      locked,
      biometry,
      lock,
      unlockWithSecret,
      unlockWithBiometrics,
      enableWithSecret,
      enableWithFingerprint,
      changeSecret,
      disable,
    ],
  );

  return <AppLockContext.Provider value={value}>{children}</AppLockContext.Provider>;
}
