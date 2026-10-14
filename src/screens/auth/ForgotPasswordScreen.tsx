import React, { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ArrowRight, Mail } from 'lucide-react-native';
import AuthLayout from './AuthLayout';
import TextField from '../../components/ui/TextField';
import Button from '../../components/ui/Button';
import { useAuth } from '../../auth/AuthContext';
import { holdDevResetCode } from '../../auth/resetFlow';
import { validateForgotPassword } from '../../auth/validation';
import type { ErrorKeyOverrides } from '../../errors/messages';
import { useFormErrors } from '../../forms/useFormErrors';
import type { AuthStackParamList } from '../../navigation/RootNavigator';
import { colors, spacing, typography } from '../../theme';

type ScreenProps = NativeStackScreenProps<AuthStackParamList, 'ForgotPassword'>;

const FIELDS = ['email'] as const;

// Here a 429 means too many codes were asked for (per address or per phone).
const MESSAGES: ErrorKeyOverrides = {
  TOO_MANY_REQUESTS: 'auth.errors.tooManyCodes',
};

// KZ-06: the email alone asks for a code. The API answers the same way
// whether or not an account has this address, so the next screen always
// opens and says "if an account exists, we've sent a code".
function ForgotPasswordScreen({ navigation }: ScreenProps) {
  const { t } = useTranslation();
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const form = useFormErrors(FIELDS, validateForgotPassword({ email }), MESSAGES);

  const submit = async () => {
    if (submitting || !form.attempt()) return;
    setSubmitting(true);
    try {
      const address = email.trim();
      const result = await requestPasswordReset({ email: address });
      holdDevResetCode(result.devCode);
      navigation.navigate('ResetPassword', { email: address, requestedAt: Date.now() });
    } catch (err) {
      form.fail(err);
    } finally {
      setSubmitting(false);
    }
  };

  // For someone who already has a code (the app was closed while they read
  // the email): asking again would replace it.
  const haveCode = () => {
    if (!form.attempt()) return;
    navigation.navigate('ResetPassword', { email: email.trim() });
  };

  return (
    <AuthLayout
      title={t('auth.forgotPasswordTitle')}
      subtitle={t('auth.forgotPasswordMessage')}
    >
      <TextField
        testID="forgot-email"
        label={t('auth.email')}
        leftIcon={Mail}
        keyboardType="email-address"
        autoComplete="email"
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
      <Button
        testID="forgot-have-code"
        label={t('auth.haveResetCode')}
        variant="ghost"
        disabled={submitting}
        onPress={haveCode}
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
    marginBottom: spacing.md,
  },
});

export default ForgotPasswordScreen;
