import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Building2, Store } from 'lucide-react-native';
import AuthLayout from '../auth/AuthLayout';
import TextField from '../../components/ui/TextField';
import Button from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { useAuth } from '../../auth/AuthContext';
import {
  hasErrors,
  validateProfile,
  type AuthFieldErrors,
} from '../../auth/validation';
import { errorMessage } from '../../errors/messages';
import { colors, spacing, typography } from '../../theme';

function BusinessProfileScreen() {
  const { t } = useTranslation();
  const { completeBusinessProfile } = useAuth();
  const toast = useToast();
  const [companyName, setCompanyName] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [errors, setErrors] = useState<AuthFieldErrors>({});
  const [formError, setFormError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (submitting) return;
    const validationErrors = validateProfile({ companyName, businessType });
    if (hasErrors(validationErrors)) {
      setErrors(validationErrors);
      return;
    }
    setErrors({});
    setFormError(null);
    setSubmitting(true);
    try {
      await completeBusinessProfile({ companyName: companyName.trim(), businessType: businessType.trim() });
      toast.show('success', t('business.saved'));
    } catch (err) {
      setFormError(err);
      setSubmitting(false);
    }
  };

  const canSubmit = !hasErrors(
    validateProfile({ companyName, businessType }),
  );

  return (
    <AuthLayout
      title={t('business.welcomeTitle')}
      subtitle={t('business.welcomeSubtitle')}
    >
      <TextField
        testID="business-name"
        label={t('business.companyName')}
        leftIcon={Building2}
        value={companyName}
        onChangeText={setCompanyName}
        error={errors.companyName ? t(errors.companyName) : undefined}
        autoCapitalize="words"
        placeholder={t('business.companyNamePlaceholder')}
      />
      <TextField
        testID="business-type"
        label={t('business.businessType')}
        leftIcon={Store}
        value={businessType}
        onChangeText={setBusinessType}
        error={errors.businessType ? t(errors.businessType) : undefined}
        autoCapitalize="words"
        placeholder={t('business.businessTypePlaceholder')}
        hint={t('business.businessTypeHint')}
      />
      {formError ? <Text style={styles.formError}>{errorMessage(formError, t)}</Text> : null}
      <Text style={styles.privacyNote}>{t('business.privacyNote')}</Text>
      <Button
        testID="business-submit"
        label={t('business.continue')}
        loading={submitting}
        disabled={!canSubmit}
        onPress={submit}
        style={styles.button}
      />
      <View style={styles.footnoteWrap}>
        <Text style={styles.footnote}>{t('business.laterNote')}</Text>
      </View>
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
  privacyNote: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  button: {
    marginBottom: spacing.lg,
  },
  footnoteWrap: {
    alignItems: 'center',
  },
  footnote: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
});

export default BusinessProfileScreen;