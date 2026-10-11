import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AlertTriangle, Trash2 } from 'lucide-react-native';
import Screen from '../../components/ui/Screen';
import AppHeader from '../../components/ui/AppHeader';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { useAuth } from '../../auth/AuthContext';
import { errorMessage } from '../../errors/messages';
import type { MoreStackParamList } from '../../navigation/RootNavigator';
import { colors, radius, spacing, typography } from '../../theme';

type ScreenProps = NativeStackScreenProps<MoreStackParamList, 'DeleteAccount'>;

function DeleteAccountScreen({ navigation }: ScreenProps) {
  const { t } = useTranslation();
  const { deleteAccount } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [formError, setFormError] = useState<unknown>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (deleting) return;
    setFormError(null);
    setDeleting(true);
    try {
      await deleteAccount();
    } catch (err) {
      setFormError(err);
      setConfirming(false);
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
        {formError ? <Text style={styles.formError}>{errorMessage(formError, t)}</Text> : null}
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
        onConfirm={handleDelete}
        onCancel={() => setConfirming(false)}
      />
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
  },
});

export default DeleteAccountScreen;