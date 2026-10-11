import React, { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ArrowRight, Mail, User } from 'lucide-react-native';
import AuthLayout from './AuthLayout';
import TextField from '../../components/ui/TextField';
import Button from '../../components/ui/Button';
import { useAuth } from '../../auth/AuthContext';
import {
  hasErrors,
  validateForgotPassword,
  type AuthFieldErrors,
} from '../../auth/validation';
import { LocalError, errorMessage } from '../../errors/messages';
import type { AuthStackParamList } from '../../navigation/RootNavigator';
import { colors, spacing, typography } from '../../theme';

type ScreenProps = NativeStackScreenProps<AuthStackParamList, 'ForgotPassword'>;

function ForgotPasswordScreen({ navigation }: ScreenProps) {
  const { t } = useTranslation();
  const { requestPasswordReset } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<AuthFieldErrors>({});
  const [formError, setFormError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (submitting) return;
    const validationErrors = validateForgotPassword({ firstName, lastName, email });
    if (hasErrors(validationErrors)) {
      setErrors(validationErrors);
      return;
    }
    setErrors({});
    setFormError(null);
    setSubmitting(true);
    try {
      const result = await requestPasswordReset({ firstName, lastName, email });
      if (!result.resetToken) {
        setFormError(new LocalError('auth.resetVerificationFailed'));
        return;
      }
      navigation.navigate('ResetPassword', { token: result.resetToken });
    } catch (err) {
      setFormError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = !hasErrors(
    validateForgotPassword({ firstName, lastName, email }),
  );

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
        error={errors.firstName ? t(errors.firstName) : undefined}
      />
      <TextField
        testID="forgot-last-name"
        label={t('auth.lastName')}
        leftIcon={User}
        value={lastName}
        onChangeText={setLastName}
        error={errors.lastName ? t(errors.lastName) : undefined}
      />
      <TextField
        testID="forgot-email"
        label={t('auth.email')}
        leftIcon={Mail}
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        error={errors.email ? t(errors.email) : undefined}
        autoCapitalize="none"
      />
      {formError ? <Text style={styles.formError}>{errorMessage(formError, t)}</Text> : null}
      <Button
        testID="forgot-submit"
        label={t('auth.forgotPasswordButton')}
        icon={ArrowRight}
        loading={submitting}
        disabled={!canSubmit}
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