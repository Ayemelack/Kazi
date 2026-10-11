import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Building2, Save, Store, User } from 'lucide-react-native';
import Screen from '../../components/ui/Screen';
import AppHeader from '../../components/ui/AppHeader';
import TextField from '../../components/ui/TextField';
import Button from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { useAuth } from '../../auth/AuthContext';
import { validateAccountProfile } from '../../auth/validation';
import { useFormErrors } from '../../forms/useFormErrors';
import type { MoreStackParamList } from '../../navigation/RootNavigator';
import { colors, spacing, typography } from '../../theme';

type ScreenProps = NativeStackScreenProps<MoreStackParamList, 'MyBusiness'>;

const FIELDS = ['companyName', 'businessType', 'firstName', 'lastName'] as const;

function MyBusinessScreen({ navigation }: ScreenProps) {
  const { t } = useTranslation();
  const { user, completeBusinessProfile, updateAccountNames } = useAuth();
  const toast = useToast();
  const [companyName, setCompanyName] = useState(user?.companyName ?? '');
  const [businessType, setBusinessType] = useState(user?.businessType ?? '');
  const [firstName, setFirstName] = useState(user?.firstName ?? '');
  const [lastName, setLastName] = useState(user?.lastName ?? '');
  const [submitting, setSubmitting] = useState(false);
  const form = useFormErrors(
    FIELDS,
    validateAccountProfile({ companyName, businessType, firstName, lastName }),
  );

  const save = async () => {
    if (submitting || !form.attempt()) return;
    setSubmitting(true);
    try {
      const nameChanged =
        (user?.firstName ?? '') !== firstName.trim() ||
        (user?.lastName ?? '') !== lastName.trim() ||
        !user?.firstName ||
        !user?.lastName;
      if (nameChanged) {
        await updateAccountNames({ firstName: firstName.trim(), lastName: lastName.trim() });
      }
      await completeBusinessProfile({
        companyName: companyName.trim(),
        businessType: businessType.trim(),
      });
      toast.show('success', t('business.updated'));
      navigation.goBack();
    } catch (err) {
      form.fail(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen scroll>
      <AppHeader title={t('more.myBusiness')} onBack={() => navigation.goBack()} />
      <View style={styles.content}>
        <TextField
          testID="mybusiness-name"
          label={t('business.companyName')}
          leftIcon={Building2}
          value={companyName}
          onChangeText={setCompanyName}
          autoCapitalize="words"
          onBlur={() => form.touch('companyName')}
          error={form.fieldError('companyName')}
        />
        <TextField
          testID="mybusiness-type"
          label={t('business.businessType')}
          leftIcon={Store}
          value={businessType}
          onChangeText={setBusinessType}
          autoCapitalize="words"
          onBlur={() => form.touch('businessType')}
          error={form.fieldError('businessType')}
        />
        <View style={styles.divider} />
        <Text style={styles.sectionLabel}>{t('business.accountDetails')}</Text>
        <View style={styles.nameRow}>
          <View style={styles.nameField}>
            <TextField
              testID="mybusiness-first"
              label={t('auth.firstName')}
              leftIcon={User}
              value={firstName}
              onChangeText={setFirstName}
              autoCapitalize="words"
              onBlur={() => form.touch('firstName')}
              error={form.fieldError('firstName')}
            />
          </View>
          <View style={styles.nameField}>
            <TextField
              testID="mybusiness-last"
              label={t('auth.lastName')}
              value={lastName}
              onChangeText={setLastName}
              autoCapitalize="words"
              onBlur={() => form.touch('lastName')}
              error={form.fieldError('lastName')}
            />
          </View>
        </View>
        {form.formError ? <Text style={styles.formError}>{form.formError}</Text> : null}
        <Button
          testID="mybusiness-save"
          label={t('common.save')}
          icon={Save}
          loading={submitting}
          disabled={form.blocked}
          onPress={save}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    marginTop: spacing.md,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.lg,
  },
  sectionLabel: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  nameRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  nameField: {
    flex: 1,
  },
  formError: {
    ...typography.body,
    color: colors.error,
    marginBottom: spacing.lg,
    textAlign: 'center',
  },
});

export default MyBusinessScreen;