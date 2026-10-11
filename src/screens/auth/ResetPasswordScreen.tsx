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
  passwordStrength,
  validateConfirmPassword,
  validateResetPassword,
} from '../../auth/validation';
import { LocalError, type ErrorKeyOverrides } from '../../errors/messages';
import { useFormErrors } from '../../forms/useFormErrors';
import type { AuthStackParamList } from '../../navigation/RootNavigator';
import { colors, radius, spacing, typography } from '../../theme';

type ScreenProps = NativeStackScreenProps<AuthStackParamList, 'ResetPassword'>;

// On this screen the token is the reset code, not the session.
const RESET_CODE_MESSAGES: ErrorKeyOverrides = {
  INVALID_TOKEN: 'auth.errors.tokenInvalid',
  TOKEN_EXPIRED: 'auth.errors.tokenExpired',
};

const FIELDS = ['password', 'confirmPassword'] as const;

function ResetPasswordScreen({ navigation, route }: ScreenProps) {
  const { t } = useTranslation();
  const { resetPassword } = useAuth();
  const toast = useToast();
  const token = route.params?.token?.trim() ?? '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const strength = useMemo(() => passwordStrength(password), [password]);

  const errors = validateResetPassword({ password });
  const confirmError = validateConfirmPassword(password, confirmPassword);
  if (confirmError) {
    errors.confirmPassword = confirmError;
  }
  const form = useFormErrors(FIELDS, errors, RESET_CODE_MESSAGES);

  const submit = async () => {
    if (submitting) return;
    const valid = form.attempt();
    if (token.length === 0) {
      form.fail(new LocalError('auth.resetSessionEnded'));
      return;
    }
    if (!valid) return;
    setSubmitting(true);
    try {
      await resetPassword({ token, password });
      toast.show('success', t('auth.passwordResetSuccess'));
      navigation.navigate('Login');
    } catch (err) {
      form.fail(err);
    } finally {
      setSubmitting(false);
    }
  };

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
      {form.formError ? <Text style={styles.formError}>{form.formError}</Text> : null}
      <Button
        testID="reset-submit"
        label={t('auth.resetPasswordButton')}
        loading={submitting}
        disabled={form.blocked}
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