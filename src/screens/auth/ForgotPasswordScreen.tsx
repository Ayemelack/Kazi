import React, { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ArrowRight, Mail, User } from 'lucide-react-native';
import AuthLayout from './AuthLayout';
import TextField from '../../components/ui/TextField';
import Button from '../../components/ui/Button';
import { useAuth } from '../../auth/AuthContext';
import { validateForgotPassword } from '../../auth/validation';
import { LocalError } from '../../errors/messages';
import { useFormErrors } from '../../forms/useFormErrors';
import type { AuthStackParamList } from '../../navigation/RootNavigator';
import { colors, spacing, typography } from '../../theme';

type ScreenProps = NativeStackScreenProps<AuthStackParamList, 'ForgotPassword'>;

const FIELDS = ['firstName', 'lastName', 'email'] as const;

function ForgotPasswordScreen({ navigation }: ScreenProps) {
  const { t } = useTranslation();
  const { requestPasswordReset } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const form = useFormErrors(FIELDS, validateForgotPassword({ firstName, lastName, email }));

  const submit = async () => {
    if (submitting || !form.attempt()) return;
    setSubmitting(true);
    try {
      const result = await requestPasswordReset({ firstName, lastName, email });
      if (!result.resetToken) {
        form.fail(new LocalError('auth.resetVerificationFailed'));
        return;
      }
      navigation.navigate('ResetPassword', { token: result.resetToken });
    } catch (err) {
      form.fail(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title={t('auth.forgotPasswordTitle')}
      subtitle={t('auth.forgotPasswordMessage')}
    >
      <TextField
        testID="forgot-first-name"
        label={t('auth.firstName')}
        leftIcon={User}
        value={firstName}
        onChangeText={setFirstName}
        onBlur={() => form.touch('firstName')}
        error={form.fieldError('firstName')}
      />
      <TextField
        testID="forgot-last-name"
        label={t('auth.lastName')}
        leftIcon={User}
        value={lastName}
        onChangeText={setLastName}
        onBlur={() => form.touch('lastName')}
        error={form.fieldError('lastName')}
      />
      <TextField
        testID="forgot-email"
        label={t('auth.email')}
        leftIcon={Mail}
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        onBlur={() => form.touch('email')}
        error={form.fieldError('email')}
        autoCapitalize="none"
      />
      {form.formError ? <Text style={styles.formError}>{form.formError}</Text> : null}
      <Button
        testID="forgot-submit"
        label={t('auth.forgotPasswordButton')}
        icon={ArrowRight}
        loading={submitting}
        disabled={form.blocked}
        onPress={submit}
        style={styles.button}
      />
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  formError: {
    ...typography.body,
    color: colors.error,
    marginBottom: spacing.lg,
    textAlign: 'center',
  },
  button: {
    marginBottom: spacing.xl,
  },
});

export default ForgotPasswordScreen;