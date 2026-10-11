import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LogIn, Mail, User } from 'lucide-react-native';
import AuthLayout from './AuthLayout';
import TextField from '../../components/ui/TextField';
import Button from '../../components/ui/Button';
import { useAuth } from '../../auth/AuthContext';
import {
  hasErrors,
  validateLogin,
  type AuthFieldErrors,
} from '../../auth/validation';
import { errorMessage } from '../../errors/messages';
import type { AuthStackParamList } from '../../navigation/RootNavigator';
import { colors, spacing, typography } from '../../theme';

type ScreenProps = NativeStackScreenProps<AuthStackParamList, 'Login'>;

function LoginScreen({ navigation }: ScreenProps) {
  const { t } = useTranslation();
  const { logIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<AuthFieldErrors>({});
  const [formError, setFormError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (submitting) return;
    const validationErrors = validateLogin({ email, password });
    if (hasErrors(validationErrors)) {
      setErrors(validationErrors);
      return;
    }
    setErrors({});
    setFormError(null);
    setSubmitting(true);
    try {
      await logIn({ email, password });
    } catch (err) {
      setFormError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = !hasErrors(validateLogin({ email, password }));

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
        error={errors.email ? t(errors.email) : undefined}
        autoCapitalize="none"
      />
      <TextField
        testID="login-password"
        label={t('auth.password')}
        leftIcon={User}
        secure
        value={password}
        onChangeText={setPassword}
        error={errors.password ? t(errors.password) : undefined}
      />
      <Pressable
        onPress={() => navigation.navigate('ForgotPassword')}
        hitSlop={8}
        style={styles.forgotWrap}
      >
        <Text style={styles.link}>{t('auth.forgotPassword')}</Text>
      </Pressable>
      {formError ? <Text style={styles.formError}>{errorMessage(formError, t)}</Text> : null}
      <Button
        testID="login-submit"
        label={t('auth.signInButton')}
        icon={LogIn}
        loading={submitting}
        disabled={!canSubmit}
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