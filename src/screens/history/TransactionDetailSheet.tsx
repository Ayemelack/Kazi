import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react-native';
import { formatMoney } from '@kazi/shared';
import Button from '../../components/ui/Button';
import { errorMessage } from '../../errors/messages';
import { getTransaction } from '../../offline/api';
import type { Transaction } from '../../transactions/types';
import { colors, radius, spacing, typography } from '../../theme';

// KZ-07: what History shows when a sale, expense or money-added row is tapped.
// The record is loaded fresh from the server (the History row only carries a
// summary) so Correct can prefill every field, and Delete / Correct act on
// what is really stored.

interface Props {
  /** The transaction to show; null closes the sheet. */
  transactionId: number | null;
  onClose: () => void;
  onDelete: (transaction: Transaction) => void;
  onCorrect: (transaction: Transaction) => void;
}

const TYPE_LABEL_KEY: Record<Transaction['type'], string> = {
  sale: 'history.labels.sale',
  purchase: 'history.labels.spend',
  capital: 'history.labels.capital',
};

export default function TransactionDetailSheet({
  transactionId,
  onClose,
  onDelete,
  onCorrect,
}: Props) {
  const { t } = useTranslation();
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt(value => value + 1), []);

  useEffect(() => {
    if (transactionId === null) {
      return;
    }
    let cancelled = false;
    setTransaction(null);
    setError(null);
    getTransaction(transactionId).then(
      result => {
        if (!cancelled) {
          setTransaction(result.transaction);
        }
      },
      err => {
        if (!cancelled) {
          setError(err);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [transactionId, attempt]);

  const visible = transactionId !== null;
  const sign = transaction?.type === 'purchase' ? '−' : '+';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button">
        <View style={styles.sheet} onStartShouldSetResponder={() => true}>
          <View style={styles.header}>
            <Text style={styles.title}>{t('transactions.detailTitle')}</Text>
            <Pressable
              testID="transaction-detail-close"
              accessibilityRole="button"
              accessibilityLabel={t('common.cancel')}
              onPress={onClose}
              hitSlop={8}
              style={styles.close}
            >
              <X size={22} color={colors.textSecondary} />
            </Pressable>
          </View>

          {error ? (
            <View style={styles.centered}>
              <Text style={styles.error}>{errorMessage(error, t)}</Text>
              <Button
                testID="transaction-detail-retry"
                label={t('common.retry')}
                variant="outline"
                size="md"
                onPress={retry}
              />
            </View>
          ) : transaction === null ? (
            <View style={styles.centered}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <>
              <Text testID="transaction-detail-type" style={styles.type}>
                {t(TYPE_LABEL_KEY[transaction.type])}
              </Text>
              <Text testID="transaction-detail-amount" style={styles.amount}>
                {sign}
                {formatMoney(transaction.amount)}
              </Text>
              <Field label={t('transactions.date')} value={transaction.date} />
              {transaction.type !== 'capital' ? (
                <Field
                  label={t('transactions.item')}
                  value={transaction.item?.name ?? t('transactions.noItem')}
                />
              ) : null}
              {transaction.quantity !== undefined ? (
                <Field label={t('transactions.quantity')} value={String(transaction.quantity)} />
              ) : null}
              <Field
                label={t('transactions.detailDescription')}
                value={transaction.description ?? t('transactions.detailNone')}
              />
              <Text style={styles.hint}>{t('transactions.detailHint')}</Text>
              <View style={styles.buttons}>
                <Button
                  testID="transaction-detail-correct"
                  label={t('transactions.correct')}
                  variant="outline"
                  size="md"
                  onPress={() => onCorrect(transaction)}
                  style={styles.button}
                />
                <Button
                  testID="transaction-detail-delete"
                  label={t('transactions.delete')}
                  variant="destructive"
                  size="md"
                  onPress={() => onDelete(transaction)}
                  style={styles.button}
                />
              </View>
            </>
          )}
        </View>
      </Pressable>
    </Modal>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  title: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  close: {
    position: 'absolute',
    right: 0,
    padding: spacing.xs,
  },
  centered: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xl,
  },
  error: {
    ...typography.body,
    color: colors.error,
    textAlign: 'center',
  },
  type: {
    ...typography.label,
    color: colors.textSecondary,
  },
  amount: {
    ...typography.display,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  field: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  fieldLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  fieldValue: {
    ...typography.body,
    color: colors.textPrimary,
    flexShrink: 1,
    textAlign: 'right',
  },
  hint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  buttons: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  button: {
    flex: 1,
  },
});
