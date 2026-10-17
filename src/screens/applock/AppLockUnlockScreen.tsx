import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Fingerprint, Lock, LockKeyhole, ShieldCheck } from 'lucide-react-native';
import Screen from '../../components/ui/Screen';
import Button from '../../components/ui/Button';
import TextField from '../../components/ui/TextField';
import { useAppLock } from '../../applock/AppLockContext';
import {
  PASSWORD_MIN_LENGTH,
  PIN_MAX_LENGTH,
  PIN_MIN_LENGTH,
  type UnlockResult,
} from '../../applock/types';
import { colors, radius, spacing, typography } from '../../theme';

type EntryMode = 'biometric' | 'secret';

function AppLockUnlockScreen() {
  const { t } = useTranslation();
  const {
    method,
    secretKind,
    hasFallback,
    biometry,
    lockoutUntil,
    unlockWithSecret,
    unlockWithBiometrics,
  } = useAppLock();

  const biometricPrimary = method === 'fingerprint' && biometry !== null;
  const [mode, setMode] = useState<EntryMode>(biometricPrimary ? 'biometric' : 'secret');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const autoPrompted = useRef(false);

  const lockoutRemainingMs = Math.max(0, lockoutUntil - now);
  const lockoutSeconds = Math.ceil(lockoutRemainingMs / 1000);
  const lockedOut = lockoutRemainingMs > 0;

  useEffect(() => {
    if (!lockedOut) {
      return;
    }
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [lockedOut]);

  const handleResult = useCallback(
    (result: UnlockResult) => {
      if (result === 'ok') {
        setError(null);
        setSecret('');
        return;
      }
      if (result === 'locked') {
        setNow(Date.now());
        setError(null);
        return;
      }
      if (result === 'unavailable') {
        if (biometricPrimary) {
          setMode('secret');
        }
        setError(t('appLock.fingerprintUnavailable'));
        return;
      }
      if (result === 'cancelled') {
        setError(null);
        return;
      }
      setError(t('appLock.incorrect'));
    },
    [biometricPrimary, t],
  );

  const submitSecret = useCallback(async () => {
    if (busy || lockedOut) {
      return;
    }
    setBusy(true);
    try {
      const result = await unlockWithSecret(secret);
      handleResult(result);
    } finally {
      setBusy(false);
    }
  }, [busy, handleResult, lockedOut, secret, unlockWithSecret]);

  const submitBiometric = useCallback(async () => {
    if (busy || !biometricPrimary) {
      return;
    }
    setBusy(true);
    try {
      const result = await unlockWithBiometrics();
      handleResult(result);
    } finally {
      setBusy(false);
    }
  }, [biometricPrimary, busy, handleResult, unlockWithBiometrics]);

  useEffect(() => {
    if (mode === 'biometric' && biometricPrimary && !autoPrompted.current && !lockedOut) {
      autoPrompted.current = true;
      submitBiometric();
    }
  }, [biometricPrimary, lockedOut, mode, submitBiometric]);

  const isPinEntry = secretKind === 'pin';
  const showFingerprintSwitch = mode === 'secret' && biometricPrimary;
  const showSecretUnavailable = mode === 'secret' && !hasFallback;

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.lockBadge}>
        <Lock size={30} color={colors.primaryDark} />
      </View>
      <Text style={styles.title}>{t('appLock.lockedTitle')}</Text>

      {lockedOut ? (
        <View style={styles.lockoutBox} testID="applock-lockout">
          <ShieldCheck size={18} color={colors.warning} />
          <Text style={styles.lockoutText}>
            {t('appLock.lockoutMessage', { seconds: lockoutSeconds })}
          </Text>
        </View>
      ) : (
        <Text style={styles.subtitle}>
          {showSecretUnavailable
            ? t('appLock.fingerprintUnavailable')
            : mode === 'biometric'
            ? t('appLock.fingerprintPrompt')
            : isPinEntry
            ? t('appLock.pinPrompt')
            : t('appLock.passwordPrompt')}
        </Text>
      )}

      <View style={styles.form}>
        {mode === 'biometric' ? (
          <Button
            testID="applock-biometric"
            label={t('appLock.unlockWithFingerprint')}
            icon={Fingerprint}
            loading={busy}
            disabled={busy || lockedOut}
            onPress={submitBiometric}
          />
        ) : showSecretUnavailable ? null : (
          <>
            <TextField
              testID="applock-secret-input"
              value={secret}
              onChangeText={value => {
                setSecret(value);
                if (error) {
                  setError(null);
                }
              }}
              placeholder={isPinEntry ? t('appLock.pinPlaceholder') : t('appLock.passwordPlaceholder')}
              secure
              leftIcon={isPinEntry ? LockKeyhole : Lock}
              keyboardType={isPinEntry ? 'number-pad' : 'default'}
              maxLength={isPinEntry ? PIN_MAX_LENGTH : undefined}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button
              testID="applock-submit"
              label={t('appLock.unlock')}
              loading={busy}
              disabled={busy || lockedOut || secret.length < (isPinEntry ? PIN_MIN_LENGTH : PASSWORD_MIN_LENGTH)}
              onPress={submitSecret}
            />
            {showFingerprintSwitch ? (
              <Button
                testID="applock-use-fingerprint"
                label={t('appLock.useFingerprint')}
                variant="ghost"
                icon={Fingerprint}
                onPress={() => {
                  setError(null);
                  setMode('biometric');
                  submitBiometric();
                }}
              />
            ) : null}
          </>
        )}

        {mode === 'biometric' && hasFallback ? (
          <Button
            testID="applock-use-secret"
            label={isPinEntry ? t('appLock.usePin') : t('appLock.usePassword')}
            variant="ghost"
            onPress={() => {
              setError(null);
              setMode('secret');
            }}
          />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockBadge: {
    width: 68,
    height: 68,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  lockoutBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
    maxWidth: 340,
  },
  lockoutText: {
    ...typography.body,
    color: colors.warning,
    flexShrink: 1,
  },
  form: {
    width: '100%',
    marginTop: spacing.xxl,
  },
  error: {
    ...typography.caption,
    color: colors.error,
    textAlign: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
});

export default AppLockUnlockScreen;
