import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LogIn, Mail, User } from 'lucide-react-native';
import AuthLayout from './AuthLayout';
import TextField from '../../components/ui/TextField';
import Button from '../../components/ui/Button';
import { useAuth } from '../../auth/AuthContext';
import { validateLogin } from '../../auth/validation';
import { useFormErrors } from '../../forms/useFormErrors';
import type { AuthStackParamList } from '../../navigation/RootNavigator';
import { colors, spacing, typography } from '../../theme';

type ScreenProps = NativeStackScreenProps<AuthStackParamList, 'Login'>;

const FIELDS = ['email', 'password'] as const;

function LoginScreen({ navigation }: ScreenProps) {
  const { t } = useTranslation();
  const { logIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const form = useFormErrors(FIELDS, validateLogin({ email, password }));

  const submit = async () => {
    if (submitting || !form.attempt()) return;
    setSubmitting(true);
    try {
      await logIn({ email, password });
    } catch (err) {
      form.fail(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title={t('auth.welcomeBack')}
      subtitle={t('auth.signInSubtitle')}
    >
      <TextField
        testID="login-email"
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
        testID="login-password"
        label={t('auth.password')}
        leftIcon={User}
        secure
        value={password}
        onChangeText={setPassword}
        onBlur={() => form.touch('password')}
        error={form.fieldError('password')}
      />
      <Pressable
        onPress={() => navigation.navigate('ForgotPassword')}
        hitSlop={8}
        style={styles.forgotWrap}
      >
        <Text style={styles.link}>{t('auth.forgotPassword')}</Text>
      </Pressable>
      {form.formError ? <Text style={styles.formError}>{form.formError}</Text> : null}
      <Button
        testID="login-submit"
        label={t('auth.signInButton')}
        icon={LogIn}
        loading={submitting}
        disabled={form.blocked}
        onPress={submit}
        style={styles.button}
      />
      <View style={styles.footer}>
        <Text style={styles.footerText}>{t('auth.noAccount')}</Text>
        <Pressable hitSlop={8} onPress={() => navigation.navigate('Signup')}>
          <Text style={[styles.link, styles.footerLink]}>
            {t('auth.signUpButton')}
          </Text>
        </Pressable>
      </View>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  forgotWrap: {
    alignSelf: 'flex-end',
    marginBottom: spacing.xl,
  },
  link: {
    ...typography.label,
    color: colors.primaryDark,
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
  footerLink: {
    marginLeft: spacing.xs,
  },
});

export default LoginScreen;