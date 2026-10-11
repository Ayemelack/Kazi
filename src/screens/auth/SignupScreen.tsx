import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Mail, ShieldCheck, User } from 'lucide-react-native';
import { ApiError } from '../../errors/ApiError';
import AuthLayout from './AuthLayout';
import TextField from '../../components/ui/TextField';
import Button from '../../components/ui/Button';
import { useAuth } from '../../auth/AuthContext';
import {
  hasErrors,
  passwordStrength,
  validateSignup,
  type AuthFieldErrors,
} from '../../auth/validation';
import { errorMessage } from '../../errors/messages';
import type { AuthStackParamList } from '../../navigation/RootNavigator';
import { colors, radius, spacing, typography } from '../../theme';

type ScreenProps = NativeStackScreenProps<AuthStackParamList, 'Signup'>;

function SignupScreen({ navigation }: ScreenProps) {
  const { t } = useTranslation();
  const { signUp } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<AuthFieldErrors>({});
  const [formError, setFormError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  const strength = useMemo(() => passwordStrength(password), [password]);

  const submit = async () => {
    if (submitting) return;
    const validationErrors = validateSignup({ firstName, lastName, email, password });
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
      await signUp({ firstName, lastName, email, password });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_IN_USE') {
        setErrors({ email: 'errors.codes.EMAIL_IN_USE' });
      } else {
        setFormError(err);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const liveErrors = validateSignup({ firstName, lastName, email, password });
  if (confirmPassword.length > 0 && confirmPassword !== password) {
    liveErrors.confirmPassword = 'auth.errors.passwordMismatch';
  }
  const canSubmit = !hasErrors(liveErrors) && confirmPassword.length > 0;

  return (
    <AuthLayout
      title={t('auth.createYourAccount')}
      subtitle={t('auth.signUpSubtitle')}
    >
      <View style={styles.nameRow}>
        <View style={styles.nameField}>
          <TextField
            testID="signup-first-name"
            label={t('auth.firstName')}
            leftIcon={User}
            value={firstName}
            onChangeText={setFirstName}
            error={errors.firstName ? t(errors.firstName) : undefined}
            autoCapitalize="words"
          />
        </View>
        <View style={styles.nameField}>
          <TextField
            testID="signup-last-name"
            label={t('auth.lastName')}
            value={lastName}
            onChangeText={setLastName}
            error={errors.lastName ? t(errors.lastName) : undefined}
            autoCapitalize="words"
          />
        </View>
      </View>
      <TextField
        testID="signup-email"
        label={t('auth.email')}
        leftIcon={Mail}
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        error={errors.email ? t(errors.email) : undefined}
        autoCapitalize="none"
      />
      <TextField
        testID="signup-password"
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
        testID="signup-confirm"
        label={t('auth.confirmPassword')}
        leftIcon={User}
        secure
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        error={errors.confirmPassword ? t(errors.confirmPassword) : undefined}
      />
      {formError ? <Text style={styles.formError}>{errorMessage(formError, t)}</Text> : null}
      <Button
        testID="signup-submit"
        label={t('auth.signUpButton')}
        loading={submitting}
        disabled={!canSubmit}
        onPress={submit}
        style={styles.button}
      />
      <View style={styles.footer}>
        <Text style={styles.footerText}>{t('auth.haveAccount')}</Text>
        <Pressable hitSlop={8} onPress={() => navigation.navigate('Login')}>
          <Text style={[styles.link, styles.footerLink]}>
            {t('auth.signInButton')}
          </Text>
        </Pressable>
      </View>
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
  nameRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  nameField: {
    flex: 1,
  },
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
  button: {
    marginBottom: spacing.xl,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  footerText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  link: {
    ...typography.label,
    color: colors.primaryDark,
  },
  footerLink: {
    marginLeft: spacing.xs,
  },
});

export default SignupScreen;