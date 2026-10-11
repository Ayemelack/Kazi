import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AlertCircle } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import Button from './Button';
import { colors, radius, spacing, typography } from '../../theme';

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

function ErrorState({ message, onRetry }: ErrorStateProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.container}>
      <View style={styles.iconWrap}>
        <AlertCircle size={28} color={colors.error} strokeWidth={2} />
      </View>
      <Text style={styles.message}>
        {message ?? t('errors.generic')}
      </Text>
      {onRetry ? (
        <Button label={t('common.retry')} onPress={onRetry} style={styles.action} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: radius.xl,
    backgroundColor: colors.errorSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  message: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  action: {
    alignSelf: 'stretch',
  },
});

export default ErrorState;