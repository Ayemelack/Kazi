import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { KeyRound, ShieldCheck, User } from 'lucide-react-native';
import AuthLayout from './AuthLayout';
import TextField from '../../components/ui/TextField';
import Button from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { useAuth } from '../../auth/AuthContext';
import {
  cleanResetCode,
  holdDevResetCode,
  resetCodeFailureKey,
  takeDevResetCode,
} from '../../auth/resetFlow';
import {
  passwordStrength,
  validateConfirmPassword,
  validateResetPassword,
} from '../../auth/validation';
import { ApiError } from '../../errors/ApiError';
import { LocalError } from '../../errors/messages';
import { useFormErrors } from '../../forms/useFormErrors';
import type { AuthStackParamList } from '../../navigation/RootNavigator';
import { colors, radius, spacing, typography } from '../../theme';

type ScreenProps = NativeStackScreenProps<AuthStackParamList, 'ResetPassword'>;

const FIELDS = ['code', 'password', 'confirmPassword'] as const;

// KZ-06: the code from the email and the new password. The email comes from
// the previous screen; the code never travels in navigation params (in a
// development build it may be prefilled from the API's dev shortcut).
function ResetPasswordScreen({ navigation, route }: ScreenProps) {
  const { t } = useTranslation();
  const { requestPasswordReset, resetPassword } = useAuth();
  const toast = useToast();
  const email = route.params?.email?.trim() ?? '';
  const [requestedAt, setRequestedAt] = useState(route.params?.requestedAt);
  const [code, setCode] = useState(takeDevResetCode);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [wrongTries, setWrongTries] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);

  const strength = useMemo(() => passwordStrength(password), [password]);

  const errors = validateResetPassword({ email, code, password });
  const confirmError = validateConfirmPassword(password, confirmPassword);
  if (confirmError) {
    errors.confirmPassword = confirmError;
  }
  const form = useFormErrors(FIELDS, errors);

  const submit = async () => {
    if (submitting) return;
    const valid = form.attempt();
    if (email.length === 0) {
      form.fail(new LocalError('auth.resetSessionEnded'));
      return;
    }
    if (!valid) return;
    setSubmitting(true);
    try {
      await resetPassword({ email, code, password });
      toast.show('success', t('auth.passwordResetSuccess'));
      navigation.navigate('Login');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'RESET_CODE_INVALID') {
        const tries = wrongTries + 1;
        setWrongTries(tries);
        form.fail(new LocalError(resetCodeFailureKey(tries, requestedAt)));
      } else {
        form.fail(err);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const resend = async () => {
    if (resending || email.length === 0) return;
    setResending(true);
    try {
      const result = await requestPasswordReset({ email });
      holdDevResetCode(result.devCode);
      setCode(takeDevResetCode());
      setRequestedAt(Date.now());
      setWrongTries(0);
      form.reset();
      toast.show('success', t('auth.resetCodeResent', { email }));
    } catch (err) {
      form.fail(
        err instanceof ApiError && err.code === 'TOO_MANY_REQUESTS'
          ? new LocalError('auth.errors.tooManyCodes')
          : err,
      );
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthLayout
      title={t('auth.resetPasswordTitle')}
      subtitle={email.length > 0 ? t('auth.resetCodeSent', { email }) : undefined}
    >
      {email.length === 0 && !submitting ? (
        <Text style={styles.warning}>{t('auth.resetSessionEnded')}</Text>
      ) : null}
      <TextField
        testID="reset-code"
        label={t('auth.resetCode')}
        leftIcon={KeyRound}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        value={code}
        onChangeText={text => setCode(cleanResetCode(text))}
        onBlur={() => form.touch('code')}
        error={form.fieldError('code')}
      />
      <TextField
        testID="reset-password"
        label={t('auth.password')}
        leftIcon={ShieldCheck}
        secure
        value={password}
        onChangeText={setPassword}
        onBlur={() => form.touch('password')}
        error={form.fieldError('password')}
        hint={t('auth.passwordHint')}
      />
      {password.length > 1 ? (
        <View style={styles.strengthWrap}>
          <View style={styles.strengthBars}>
            {[1, 2, 3, 4].map(level => (
              <View
                key={level}
                style={[
                  styles.strengthBar,
                  level <= strength.score && {
                    backgroundColor: STRENGTH_COLORS[strength.score],
                  },
                ]}
              />
            ))}
          </View>
          <Text style={[styles.strengthLabel, { color: STRENGTH_COLORS[strength.score] }]}>
            {t(`auth.strength.${strength.label}`)}
          </Text>
        </View>
      ) : null}
      <TextField
        testID="reset-confirm"
        label={t('auth.confirmPassword')}
        leftIcon={User}
        secure
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        onBlur={() => form.touch('confirmPassword')}
        error={form.fieldError('confirmPassword')}
      />
      {form.formError ? (
        <Text testID="reset-error" style={styles.formError}>
          {form.formError}
        </Text>
      ) : null}
      <Button
        testID="reset-submit"
        label={t('auth.resetPasswordButton')}
        loading={submitting}
        disabled={form.blocked}
        onPress={submit}
        style={styles.button}
      />
      <Button
        testID="reset-resend"
        label={t('auth.resendCode')}
        variant="ghost"
        loading={resending}
        disabled={email.length === 0 || submitting}
        onPress={resend}
        style={styles.button}
      />
    </AuthLayout>
  );
}

const STRENGTH_COLORS: Record<number, string> = {
  0: colors.error,
  1: colors.error,
  2: colors.warning,
  3: colors.primary,
  4: colors.success,
};

const styles = StyleSheet.create({
  strengthWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  strengthBars: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xs,
  },
  strengthBar: {
    flex: 1,
    height: 5,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
  },
  strengthLabel: {
    width: 64,
    ...typography.caption,
    fontWeight: '700',
    textAlign: 'right',
  },
  formError: {
    ...typography.body,
    color: colors.error,
    marginBottom: spacing.lg,
    textAlign: 'center',
  },
  warning: {
    ...typography.body,
    color: colors.error,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  button: {
    marginBottom: spacing.md,
  },
});

export default ResetPasswordScreen;
