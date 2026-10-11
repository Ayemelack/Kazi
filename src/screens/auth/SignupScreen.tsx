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
  passwordStrength,
  validateConfirmPassword,
  validateSignup,
} from '../../auth/validation';
import { useFormErrors } from '../../forms/useFormErrors';
import type { AuthStackParamList } from '../../navigation/RootNavigator';
import { colors, radius, spacing, typography } from '../../theme';

type ScreenProps = NativeStackScreenProps<AuthStackParamList, 'Signup'>;

const FIELDS = ['firstName', 'lastName', 'email', 'password', 'confirmPassword'] as const;

function SignupScreen({ navigation }: ScreenProps) {
  const { t } = useTranslation();
  const { signUp } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [emailInUse, setEmailInUse] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const strength = useMemo(() => passwordStrength(password), [password]);

  const errors = validateSignup({ firstName, lastName, email, password });
  if (!errors.email && emailInUse !== null && email.trim().toLowerCase() === emailInUse) {
    errors.email = 'errors.codes.EMAIL_IN_USE';
  }
  const confirmError = validateConfirmPassword(password, confirmPassword);
  if (confirmError) {
    errors.confirmPassword = confirmError;
  }
  const form = useFormErrors(FIELDS, errors);

  const submit = async () => {
    if (submitting || !form.attempt()) return;
    setSubmitting(true);
    try {
      await signUp({ firstName, lastName, email, password });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_IN_USE') {
        // Shown under the email field until the address changes.
        setEmailInUse(email.trim().toLowerCase());
      } else {
        form.fail(err);
      }
    } finally {
      setSubmitting(false);
    }
  };

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
            onBlur={() => form.touch('firstName')}
            error={form.fieldError('firstName')}
            autoCapitalize="words"
          />
        </View>
        <View style={styles.nameField}>
          <TextField
            testID="signup-last-name"
            label={t('auth.lastName')}
            value={lastName}
            onChangeText={setLastName}
            onBlur={() => form.touch('lastName')}
            error={form.fieldError('lastName')}
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
        onBlur={() => form.touch('email')}
        error={form.fieldError('email')}
        autoCapitalize="none"
      />
      <TextField
        testID="signup-password"
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
        testID="signup-confirm"
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
        testID="signup-submit"
        label={t('auth.signUpButton')}
        loading={submitting}
        disabled={form.blocked}
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