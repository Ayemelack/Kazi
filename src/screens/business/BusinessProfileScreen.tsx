import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Building2, Store } from 'lucide-react-native';
import AuthLayout from '../auth/AuthLayout';
import TextField from '../../components/ui/TextField';
import Button from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { useAuth } from '../../auth/AuthContext';
import { validateProfile } from '../../auth/validation';
import { useFormErrors } from '../../forms/useFormErrors';
import { colors, spacing, typography } from '../../theme';

const FIELDS = ['companyName', 'businessType'] as const;

function BusinessProfileScreen() {
  const { t } = useTranslation();
  const { completeBusinessProfile } = useAuth();
  const toast = useToast();
  const [companyName, setCompanyName] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const form = useFormErrors(FIELDS, validateProfile({ companyName, businessType }));

  const submit = async () => {
    if (submitting || !form.attempt()) return;
    setSubmitting(true);
    try {
      await completeBusinessProfile({ companyName: companyName.trim(), businessType: businessType.trim() });
      toast.show('success', t('business.saved'));
    } catch (err) {
      form.fail(err);
      setSubmitting(false);
    }
  };

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
        onBlur={() => form.touch('companyName')}
        error={form.fieldError('companyName')}
        autoCapitalize="words"
        placeholder={t('business.companyNamePlaceholder')}
      />
      <TextField
        testID="business-type"
        label={t('business.businessType')}
        leftIcon={Store}
        value={businessType}
        onChangeText={setBusinessType}
        onBlur={() => form.touch('businessType')}
        error={form.fieldError('businessType')}
        autoCapitalize="words"
        placeholder={t('business.businessTypePlaceholder')}
        hint={t('business.businessTypeHint')}
      />
      {form.formError ? <Text style={styles.formError}>{form.formError}</Text> : null}
      <Text style={styles.privacyNote}>{t('business.privacyNote')}</Text>
      <Button
        testID="business-submit"
        label={t('business.continue')}
        loading={submitting}
        disabled={form.blocked}
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