import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  Check,
  Fingerprint,
  KeyRound,
  Lock,
  LockKeyhole,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import Screen from '../../components/ui/Screen';
import AppHeader from '../../components/ui/AppHeader';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import TextField from '../../components/ui/TextField';
import { useToast } from '../../components/ui/Toast';
import { useAppLock } from '../../applock/AppLockContext';
import {
  PASSWORD_MIN_LENGTH,
  PIN_MAX_LENGTH,
  PIN_MIN_LENGTH,
  isValidAppLockPassword,
  isValidPin,
  type LockMethod,
  type SecretKind,
} from '../../applock/types';
import type { MoreStackParamList } from '../../navigation/RootNavigator';
import { colors, radius, spacing, typography } from '../../theme';

type ScreenProps = NativeStackScreenProps<MoreStackParamList, 'AppLock'>;

type CreateIntent = 'enable' | 'changeSecret';

type Flow =
  | { kind: 'idle' }
  | { kind: 'create'; secretKind: SecretKind; intent: CreateIntent }
  | { kind: 'createFingerprint' }
  | { kind: 'verify'; action: PendingAction };

type PendingAction =
  | { type: 'disable' }
  | { type: 'changeSecret'; secretKind: SecretKind }
  | { type: 'changeMethod'; method: 'pin' | 'password' }
  | { type: 'enableFingerprint' };

function AppLockScreen({ navigation }: ScreenProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const {
    enabled,
    method,
    secretKind,
    biometry,
    lockoutUntil,
    unlockWithSecret,
    unlockWithBiometrics,
    enableWithSecret,
    enableWithFingerprint,
    changeSecret,
    disable,
  } = useAppLock();

  const [flow, setFlow] = useState<Flow>({ kind: 'idle' });

  const [firstEntry, setFirstEntry] = useState('');
  const [secondEntry, setSecondEntry] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingEnable, setPendingEnable] = useState(false);

  const fingerprintAvailable = biometry !== null;
  const isLockedOut = Math.max(0, lockoutUntil - Date.now()) > 0;

  const resetForm = useCallback(() => {
    setFirstEntry('');
    setSecondEntry('');
    setError(null);
  }, []);

  const goIdle = useCallback(() => {
    resetForm();
    setFlow({ kind: 'idle' });
  }, [resetForm]);

  const handleBack = useCallback(() => {
    if (flow.kind === 'idle') {
      navigation.goBack();
      return;
    }
    if (!enabled) {
      setPendingEnable(false);
    }
    goIdle();
  }, [enabled, flow.kind, goIdle, navigation]);

  const runPendingAction = useCallback(
    async (action: PendingAction) => {
      switch (action.type) {
        case 'disable':
          await disable();
          toast.show('success', t('appLock.disabled'));
          goIdle();
          return;
        case 'changeSecret':
          resetForm();
          setFlow({ kind: 'create', secretKind: action.secretKind, intent: 'changeSecret' });
          return;
        case 'changeMethod':
          resetForm();
          setFlow({ kind: 'create', secretKind: action.method, intent: 'enable' });
          return;
        case 'enableFingerprint':
          resetForm();
          setFlow({ kind: 'createFingerprint' });
          return;
        default:
          goIdle();
      }
    },
    [disable, goIdle, resetForm, t, toast],
  );

  const startVerify = useCallback(
    (action: PendingAction) => {
      resetForm();
      setFlow({ kind: 'verify', action });
    },
    [resetForm],
  );

  const handleToggle = useCallback(
    (value: boolean) => {
      if (value) {
        if (!enabled) {
          setPendingEnable(true);
        }
        return;
      }
      setPendingEnable(false);
      if (enabled) {
        startVerify({ type: 'disable' });
      }
    },
    [enabled, startVerify],
  );

  const selectMethod = useCallback(
    (target: LockMethod) => {
      if (target === 'fingerprint') {
        if (!fingerprintAvailable) {
          return;
        }
        if (!enabled) {
          setPendingEnable(true);
          resetForm();
          setFlow({ kind: 'createFingerprint' });
          return;
        }
        if (method === 'fingerprint') {
          return;
        }
        startVerify({ type: 'enableFingerprint' });
        return;
      }
      if (!enabled) {
        setPendingEnable(true);
        resetForm();
        setFlow({ kind: 'create', secretKind: target, intent: 'enable' });
        return;
      }
      if (method === target) {
        return;
      }
      startVerify({ type: 'changeMethod', method: target });
    },
    [enabled, fingerprintAvailable, method, resetForm, startVerify],
  );

  const saveSecret = useCallback(async () => {
    if (flow.kind !== 'create' || busy) {
      return;
    }
    const { secretKind: kind, intent } = flow;
    const isPin = kind === 'pin';
    if (isPin && !isValidPin(firstEntry)) {
      setError(t('appLock.pinLengthError'));
      return;
    }
    if (!isPin && !isValidAppLockPassword(firstEntry)) {
      setError(t('appLock.passwordLengthError'));
      return;
    }
    if (firstEntry !== secondEntry) {
      setError(t(isPin ? 'appLock.pinMismatch' : 'appLock.passwordMismatch'));
      return;
    }
    setBusy(true);
    try {
      const ok =
        intent === 'changeSecret'
          ? await changeSecret(kind, firstEntry)
          : await enableWithSecret(kind, firstEntry);
      if (!ok) {
        setError(t('appLock.setupError'));
        return;
      }
      toast.show('success', t('appLock.saved'));
      setPendingEnable(false);
      goIdle();
    } finally {
      setBusy(false);
    }
  }, [busy, changeSecret, enableWithSecret, firstEntry, flow, goIdle, secondEntry, t, toast]);

  const saveFingerprint = useCallback(async () => {
    if (flow.kind !== 'createFingerprint' || busy) {
      return;
    }
    setBusy(true);
    try {
      const ok = await enableWithFingerprint();
      if (!ok) {
        setError(t('appLock.fingerprintSetupError'));
        return;
      }
      toast.show('success', t('appLock.saved'));
      setPendingEnable(false);
      goIdle();
    } finally {
      setBusy(false);
    }
  }, [busy, enableWithFingerprint, flow.kind, goIdle, t, toast]);

  const verifySecret = useCallback(async () => {
    if (flow.kind !== 'verify' || busy) {
      return;
    }
    if (isLockedOut) {
      return;
    }
    setBusy(true);
    try {
      const result = await unlockWithSecret(firstEntry);
      if (result === 'ok') {
        await runPendingAction(flow.action);
        return;
      }
      if (result === 'locked') {
        setError(t('appLock.lockoutMessage', { seconds: 30 }));
        return;
      }
      setError(t('appLock.wrongSecret'));
    } finally {
      setBusy(false);
    }
  }, [busy, firstEntry, flow, isLockedOut, runPendingAction, t, unlockWithSecret]);

  const verifyBiometric = useCallback(async () => {
    if (flow.kind !== 'verify' || busy) {
      return;
    }
    setBusy(true);
    try {
      const result = await unlockWithBiometrics();
      if (result === 'ok') {
        await runPendingAction(flow.action);
        return;
      }
      if (result === 'unavailable') {
        setError(t('appLock.fingerprintUnavailable'));
        return;
      }
      setError(t('appLock.wrongSecret'));
    } finally {
      setBusy(false);
    }
  }, [busy, flow, runPendingAction, t, unlockWithBiometrics]);

  const renderMethodRow = (
    target: LockMethod,
    label: string,
    hint: string,
    Icon: LucideIcon,
    disabled: boolean,
  ) => {
    const selected = enabled && method === target;
    return (
      <Pressable
        key={target}
        testID={`applock-method-${target}`}
        accessibilityRole="radio"
        accessibilityState={{ selected, disabled }}
        disabled={disabled}
        onPress={() => selectMethod(target)}
        style={({ pressed }) => [
          styles.methodRow,
          selected && styles.methodRowSelected,
          disabled && styles.methodRowDisabled,
          pressed && !disabled && styles.rowPressed,
        ]}
      >
        <View style={styles.methodIcon}>
          <Icon size={20} color={disabled ? colors.textMuted : colors.primaryDark} />
        </View>
        <View style={styles.methodText}>
          <Text style={styles.methodLabel}>{label}</Text>
          <Text style={styles.methodHint}>{hint}</Text>
        </View>
        {selected ? <Check size={20} color={colors.primary} /> : null}
      </Pressable>
    );
  };

  const secretIsPin = flow.kind === 'create' && flow.secretKind === 'pin';
  const createTitle =
    flow.kind === 'create'
      ? flow.intent === 'changeSecret'
        ? flow.secretKind === 'pin'
          ? t('appLock.changePinTitle')
          : t('appLock.changePasswordTitle')
        : flow.secretKind === 'pin'
        ? t('appLock.setPinTitle')
        : t('appLock.setPasswordTitle')
      : t('appLock.title');

  return (
    <Screen>
      <AppHeader title={t('more.appLock')} onBack={handleBack} />

      {flow.kind === 'idle' ? (
        <View style={styles.content}>
          <Card>
            <View style={styles.toggleRow}>
              <View style={styles.toggleIcon}>
                <Lock size={20} color={colors.primaryDark} />
              </View>
              <View style={styles.toggleText}>
                <Text style={styles.title}>{t('appLock.title')}</Text>
                <Text style={styles.description}>{t('appLock.description')}</Text>
              </View>
              <Switch
                testID="applock-toggle"
                accessibilityLabel={t('appLock.title')}
                value={enabled || pendingEnable}
                onValueChange={handleToggle}
                trackColor={{ false: colors.disabled, true: colors.primary }}
                thumbColor={colors.surface}
              />
            </View>
          </Card>

          <Text style={styles.sectionLabel}>{t('appLock.methodLabel')}</Text>
          {renderMethodRow(
            'pin',
            t('appLock.methodPin'),
            t('appLock.methodPinHint'),
            LockKeyhole,
            false,
          )}
          {renderMethodRow(
            'password',
            t('appLock.methodPassword'),
            t('appLock.methodPasswordHint'),
            KeyRound,
            false,
          )}
          {renderMethodRow(
            'fingerprint',
            t('appLock.methodFingerprint'),
            fingerprintAvailable
              ? t('appLock.methodFingerprintHint')
              : t('appLock.fingerprintUnavailable'),
            Fingerprint,
            !fingerprintAvailable,
          )}

          {enabled && method !== 'fingerprint' ? (
            <Button
              testID="applock-change-secret"
              label={
                secretKind === 'pin' ? t('appLock.changePin') : t('appLock.changePassword')
              }
              variant="outline"
              onPress={() => startVerify({ type: 'changeSecret', secretKind })}
            />
          ) : null}

          <Text style={styles.note}>{t('appLock.securityNote')}</Text>
        </View>
      ) : null}

      {flow.kind === 'create' ? (
        <View style={styles.content}>
          <Text style={styles.flowTitle}>{createTitle}</Text>

          <TextField
            testID="applock-first"
            label={secretIsPin ? t('appLock.enterPin') : t('appLock.enterPassword')}
            value={firstEntry}
            onChangeText={value => {
              setFirstEntry(value);
              if (error) setError(null);
            }}
            hint={
              secretIsPin
                ? t('appLock.pinLengthHint', { min: PIN_MIN_LENGTH, max: PIN_MAX_LENGTH })
                : t('appLock.passwordLengthHint', { min: PASSWORD_MIN_LENGTH })
            }
            secure
            leftIcon={secretIsPin ? LockKeyhole : KeyRound}
            keyboardType={secretIsPin ? 'number-pad' : 'default'}
            maxLength={secretIsPin ? PIN_MAX_LENGTH : undefined}
          />
          <TextField
            testID="applock-second"
            label={secretIsPin ? t('appLock.confirmPin') : t('appLock.confirmPassword')}
            value={secondEntry}
            onChangeText={value => {
              setSecondEntry(value);
              if (error) setError(null);
            }}
            secure
            leftIcon={secretIsPin ? LockKeyhole : KeyRound}
            keyboardType={secretIsPin ? 'number-pad' : 'default'}
            maxLength={secretIsPin ? PIN_MAX_LENGTH : undefined}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button
            testID="applock-save"
            label={t('appLock.save')}
            loading={busy}
            disabled={busy || firstEntry.length === 0 || secondEntry.length === 0}
            onPress={saveSecret}
          />
        </View>
      ) : null}

      {flow.kind === 'createFingerprint' ? (
        <View style={styles.content}>
          <Text style={styles.flowTitle}>{t('appLock.setupFingerprintTitle')}</Text>
          <Text style={styles.description}>{t('appLock.methodFingerprintHint')}</Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button
            testID="applock-save"
            label={t('appLock.save')}
            loading={busy}
            disabled={busy}
            onPress={saveFingerprint}
          />
        </View>
      ) : null}

      {flow.kind === 'verify' ? (
        <View style={styles.content}>
          <View style={styles.verifyIcon}>
            <ShieldCheck size={26} color={colors.primaryDark} />
          </View>
          <Text style={styles.flowTitle}>{t('appLock.verifyTitle')}</Text>
          <Text style={styles.description}>{t('appLock.verifyMessage')}</Text>

          {method === 'fingerprint' && fingerprintAvailable ? (
            <Button
              testID="applock-verify-biometric"
              label={t('appLock.unlockWithFingerprint')}
              icon={Fingerprint}
              loading={busy}
              disabled={busy}
              onPress={verifyBiometric}
            />
          ) : null}

          <View style={styles.verifySecret}>
            <TextField
              testID="applock-verify-input"
              label={secretKind === 'pin' ? t('appLock.enterPin') : t('appLock.enterPassword')}
              value={firstEntry}
              onChangeText={value => {
                setFirstEntry(value);
                if (error) setError(null);
              }}
              secure
              leftIcon={secretKind === 'pin' ? LockKeyhole : KeyRound}
              keyboardType={secretKind === 'pin' ? 'number-pad' : 'default'}
              maxLength={secretKind === 'pin' ? PIN_MAX_LENGTH : undefined}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button
              testID="applock-verify-submit"
              label={t('appLock.verify')}
              loading={busy}
              disabled={busy || isLockedOut || firstEntry.length === 0}
              onPress={verifySecret}
            />
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    marginTop: spacing.md,
    gap: spacing.md,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  toggleIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  toggleText: {
    flex: 1,
    marginRight: spacing.md,
  },
  title: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  description: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  sectionLabel: {
    ...typography.label,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  methodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  methodRowSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  methodRowDisabled: {
    opacity: 0.55,
  },
  rowPressed: {
    opacity: 0.85,
  },
  methodIcon: {
    width: 36,
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  methodText: {
    flex: 1,
  },
  methodLabel: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  methodHint: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  note: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: spacing.sm,
  },
  flowTitle: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  error: {
    ...typography.body,
    color: colors.error,
    textAlign: 'center',
  },
  verifyIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verifySecret: {
    marginTop: spacing.md,
  },
});

export default AppLockScreen;
