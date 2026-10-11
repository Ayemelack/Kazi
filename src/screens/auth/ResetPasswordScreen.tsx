import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ShieldCheck, User } from 'lucide-react-native';
import AuthLayout from './AuthLayout';
import TextField from '../../components/ui/TextField';
import Button from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { useAuth } from '../../auth/AuthContext';
import {
  hasErrors,
  passwordStrength,
  validateResetPassword,
  type AuthFieldErrors,
} from '../../auth/validation';
import { LocalError, errorMessage, type ErrorKeyOverrides } from '../../errors/messages';
import type { AuthStackParamList } from '../../navigation/RootNavigator';
import { colors, radius, spacing, typography } from '../../theme';

type ScreenProps = NativeStackScreenProps<AuthStackParamList, 'ResetPassword'>;

// On this screen the token is the reset code, not the session.
const RESET_CODE_MESSAGES: ErrorKeyOverrides = {
  INVALID_TOKEN: 'auth.errors.tokenInvalid',
  TOKEN_EXPIRED: 'auth.errors.tokenExpired',
};

function ResetPasswordScreen({ navigation, route }: ScreenProps) {
  const { t } = useTranslation();
  const { resetPassword } = useAuth();
  const toast = useToast();
  const token = route.params?.token?.trim() ?? '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<AuthFieldErrors>({});
  const [formError, setFormError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  const strength = useMemo(() => passwordStrength(password), [password]);

  const submit = async () => {
    if (submitting) return;
    if (token.length === 0) {
      setFormError(new LocalError('auth.resetSessionEnded'));
      return;
    }
    const validationErrors = validateResetPassword({ password });
    if (confirmPassword !== password) {
      validationErrors.confirmPassword = 'auth.errors.passwordMismatch';
    }
    if (hasErrors(validationErrors)) {
      setErrors(validationErrors);
      return;
    }
    setErrors({});
    setFormError(null);
    setSubmitting(true);
    try {
      await resetPassword({ token, password });
      toast.show('success', t('auth.passwordResetSuccess'));
      navigation.navigate('Login');
    } catch (err) {
      setFormError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const liveErrors = validateResetPassword({ password });
  if (confirmPassword.length > 0 && confirmPassword !== password) {
    liveErrors.confirmPassword = 'auth.errors.passwordMismatch';
  }
  const canSubmit = !hasErrors(liveErrors) && confirmPassword.length > 0;

  return (
    <AuthLayout
      title={t('auth.resetPasswordTitle')}
      subtitle={t('auth.resetPasswordMessage')}
    >
      {token.length === 0 && !submitting ? (
        <Text style={styles.warning}>{t('auth.resetSessionEnded')}</Text>
      ) : null}
      <TextField
        testID="reset-password"
        label={t('auth.password')}
        leftIcon={ShieldCheck}
        secure
        value={password}
        onChangeText={setPassword}
        error={errors.password ? t(errors.password) : undefined}
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
        error={errors.confirmPassword ? t(errors.confirmPassword) : undefined}
      />
      {formError ? (
        <Text style={styles.formError}>{errorMessage(formError, t, RESET_CODE_MESSAGES)}</Text>
      ) : null}
      <Button
        testID="reset-submit"
        label={t('auth.resetPasswordButton')}
        loading={submitting}
        disabled={!canSubmit}
        onPress={submit}
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
    marginBottom: spacing.xl,
  },
});

export default ResetPasswordScreen;