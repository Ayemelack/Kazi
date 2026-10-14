import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AlertTriangle, ShieldCheck, Trash2 } from 'lucide-react-native';
import Screen from '../../components/ui/Screen';
import AppHeader from '../../components/ui/AppHeader';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import TextField from '../../components/ui/TextField';
import { useAuth } from '../../auth/AuthContext';
import type { ErrorKeyOverrides } from '../../errors/messages';
import { useFormErrors } from '../../forms/useFormErrors';
import type { MoreStackParamList } from '../../navigation/RootNavigator';
import { colors, radius, spacing, typography } from '../../theme';

type ScreenProps = NativeStackScreenProps<MoreStackParamList, 'DeleteAccount'>;

const FIELDS = ['password'] as const;

// Here a 401 means the password typed to confirm was wrong, not "email or
// password" as on the sign-in screen.
const DELETE_MESSAGES: ErrorKeyOverrides = {
  INVALID_CREDENTIALS: 'deleteAccount.wrongPassword',
};

function DeleteAccountScreen({ navigation }: ScreenProps) {
  const { t } = useTranslation();
  const { deleteAccount } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const form = useFormErrors(
    FIELDS,
    { password: password.length === 0 ? 'auth.errors.required' : null },
    DELETE_MESSAGES,
  );

  const closeDialog = () => {
    setConfirming(false);
    setPassword('');
    form.reset();
  };

  // KZ-20: the password is asked for inside the confirm step and checked by
  // the server; on any failure the dialog stays open with the reason.
  const handleDelete = async () => {
    if (deleting) return;
    if (!form.attempt()) return;
    setDeleting(true);
    try {
      await deleteAccount(password);
    } catch (err) {
      form.fail(err);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Screen>
      <AppHeader title={t('more.deleteAccount')} onBack={() => navigation.goBack()} />
      <View style={styles.content}>
        <Card>
          <View style={styles.iconWrap}>
            <AlertTriangle size={26} color={colors.error} />
          </View>
          <Text style={styles.heading}>{t('deleteAccount.heading')}</Text>
          <Text style={styles.body}>{t('deleteAccount.body')}</Text>
          <Text style={styles.body}>{t('deleteAccount.body2')}</Text>
          <View style={styles.listWrap}>
            {(['money', 'products', 'debts', 'profile'] as const).map(key => (
              <Text key={key} style={styles.listItem}>
                • {t(`deleteAccount.${key}`)}
              </Text>
            ))}
          </View>
        </Card>
        <Button
          testID="delete-account-open"
          label={t('deleteAccount.button')}
          icon={Trash2}
          variant="destructive"
          onPress={() => setConfirming(true)}
        />
      </View>

      <ConfirmDialog
        visible={confirming}
        title={t('deleteAccount.confirmTitle')}
        message={t('deleteAccount.confirmMessage')}
        confirmLabel={t('deleteAccount.confirmButton')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        loading={deleting}
        confirmTestID="delete-account-confirm"
        onConfirm={handleDelete}
        onCancel={closeDialog}
      >
        <TextField
          testID="delete-account-password"
          label={t('deleteAccount.passwordLabel')}
          hint={t('deleteAccount.passwordPrompt')}
          leftIcon={ShieldCheck}
          secure
          value={password}
          onChangeText={setPassword}
          onBlur={() => form.touch('password')}
          error={form.fieldError('password')}
        />
        {form.formError ? (
          <Text testID="delete-account-error" style={styles.formError}>
            {form.formError}
          </Text>
        ) : null}
      </ConfirmDialog>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    marginTop: spacing.md,
    gap: spacing.lg,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.errorSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  heading: {
    ...typography.heading,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  listWrap: {
    marginBottom: spacing.sm,
  },
  listItem: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  formError: {
    ...typography.body,
    color: colors.error,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});

export default DeleteAccountScreen;