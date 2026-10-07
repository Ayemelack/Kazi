import React, { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ArrowRight, Check, Plus, Trash2, UserX } from 'lucide-react-native';
import Screen from '../../components/ui/Screen';
import AppHeader from '../../components/ui/AppHeader';
import Card from '../../components/ui/Card';
import EmptyState from '../../components/ui/EmptyState';
import ErrorState from '../../components/ui/ErrorState';
import LoadingView from '../../components/ui/LoadingView';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { useToast } from '../../components/ui/Toast';
import { deleteDebt, listDebts, payDebt } from '../../offline/api';
import type { Debt } from '../../debts/types';
import { formatMoney } from '../../money/format';
import { dateToDateString, todayAsDateString } from '../../transactions/validation';
import type { HistoryStackParamList } from '../../navigation/RootNavigator';
import { colors, radius, spacing, typography } from '../../theme';

type ScreenProps = NativeStackScreenProps<HistoryStackParamList, 'Debts'>;

export default function DebtsScreen({ navigation }: ScreenProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [debts, setDebts] = useState<Debt[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Debt | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [payTarget, setPayTarget] = useState<Debt | null>(null);
  const [payBusy, setPayBusy] = useState(false);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (mode === 'initial') {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);
      try {
        const result = await listDebts();
        setDebts(result.debts);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('common.error.generic'));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [t],
  );

  useFocusEffect(
    useCallback(() => {
      load('initial');
    }, [load]),
  );

  const confirmPaid = async () => {
    if (payBusy || !payTarget) return;
    setPayBusy(true);
    try {
      // The owner settles the debt on their own calendar day, which becomes
      // the day it shows up in the history.
      const result = await payDebt(payTarget.id, todayAsDateString());
      setDebts(prev =>
        prev.map(item => (item.id === result.debt.id ? result.debt : item)),
      );
      setPayTarget(null);
      toast.show('success', t('debts.markedPaid'));
    } catch (err) {
      toast.show('error', err instanceof Error ? err.message : t('common.error.generic'));
      setPayTarget(null);
    } finally {
      setPayBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (deleteBusy) return;
    if (!deleting) {
      return;
    }
    setDeleteBusy(true);
    try {
      await deleteDebt(deleting.id);
      setDebts(prev => prev.filter(item => item.id !== deleting.id));
      setDeleting(null);
      toast.show('success', t('debts.deleted'));
    } catch (err) {
      toast.show('error', err instanceof Error ? err.message : t('common.error.generic'));
      setDeleting(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  const openDebts = debts.filter(debt => debt.status === 'open');
  const totalOwed = openDebts.reduce((sum, debt) => sum + debt.amount, 0);

  return (
    <Screen>
      <AppHeader
        title={t('debts.title')}
        onBack={() => navigation.goBack()}
        rightIcon={Plus}
        onRightPress={() => navigation.navigate('DebtForm')}
      />
      {loading ? (
        <LoadingView />
      ) : error ? (
        <ErrorState message={error} onRetry={() => load('initial')} />
      ) : debts.length === 0 ? (
        <EmptyState
          icon={UserX}
          title={t('debts.emptyTitle')}
          message={t('debts.emptyMessage')}
          actionLabel={t('debts.emptyAction')}
          onAction={() => navigation.navigate('DebtForm')}
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} />
          }
          showsVerticalScrollIndicator={false}
        >
          {openDebts.length > 0 ? (
            <Card>
              <Text style={styles.sectionOverline}>{t('debts.outstanding')}</Text>
              <Text style={styles.totalOwed}>{formatMoney(totalOwed)}</Text>
              <Text style={styles.totalLabel}>{t('debts.totalOwed')}</Text>
            </Card>
          ) : null}
          {openDebts.map(debt => (
            <DebtRow
              key={debt.id}
              debt={debt}
              paying={payBusy && payTarget?.id === debt.id}
              onPay={() => setPayTarget(debt)}
              onDelete={() => setDeleting(debt)}
            />
          ))}
          {debts.some(debt => debt.status === 'paid') ? (
            <View style={styles.sectionWrap}>
              <Text style={styles.sectionLabel}>{t('debts.paid')}</Text>
              {debts
                .filter(debt => debt.status === 'paid')
                .map(debt => (
                  <DebtRow
                    key={debt.id}
                    debt={debt}
                    paying={false}
                    onPay={() => {}}
                    onDelete={() => setDeleting(debt)}
                  />
                ))}
            </View>
          ) : null}
        </ScrollView>
      )}

      <ConfirmDialog
        visible={payTarget !== null}
        title={t('debts.markPaidConfirmTitle')}
        message={t('debts.markPaidConfirmMessage')}
        confirmLabel={t('debts.markPaid')}
        cancelLabel={t('common.cancel')}
        tone="primary"
        loading={payBusy}
        onConfirm={confirmPaid}
        onCancel={() => setPayTarget(null)}
      />

      <ConfirmDialog
        visible={deleting !== null}
        title={t('debts.deleteConfirmTitle')}
        message={t('debts.deleteConfirmMessage')}
        confirmLabel={t('debts.delete')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        loading={deleteBusy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </Screen>
  );
}

type TFunction = ReturnType<typeof useTranslation>['t'];

// Settled debts show the day they were paid when the server recorded one;
// older rows (written before paid dates existed) fall back to the hint. The
// date is rendered the same way as the "Owed since" line above it, so the two
// never disagree about how a day looks.
function paidOnText(debt: Debt, t: TFunction): string {
  if (!debt.paidAt) {
    return t('debts.settledHint');
  }
  const parsed = new Date(debt.paidAt);
  const date = Number.isNaN(parsed.getTime())
    ? debt.paidAt
    : dateToDateString(parsed);
  return t('debts.paidOn', { date });
}

function DebtRow({
  debt,
  paying,
  onPay,
  onDelete,
}: {
  debt: Debt;
  paying: boolean;
  onPay: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const paid = debt.status === 'paid';

  return (
    <Card>
      <View style={styles.rowContent}>
        <View style={[styles.avatar, paid && styles.avatarPaid]}>
          <Text style={styles.avatarText}>
            {debt.name.replace(/[^a-zA-ZÀ-ÿ]/g, '').slice(0, 1).toUpperCase() || '•'}
          </Text>
        </View>
        <View style={styles.rowText}>
          <Text style={[styles.rowName, paid && styles.rowMuted]} numberOfLines={1}>
            {debt.name}
          </Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {paid
              ? paidOnText(debt, t)
              : t('debts.owedSince', { date: debt.date })}
          </Text>
        </View>
        <Text style={[styles.rowAmount, paid && styles.rowMuted]}>
          {paid ? '✓ ' : ''}
          {formatMoney(debt.amount)}
        </Text>
        {paid ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('debts.deleteA11y')}
            onPress={onDelete}
            hitSlop={8}
            style={styles.iconButton}
          >
            <Trash2 size={18} color={colors.textMuted} />
          </Pressable>
        ) : paying ? (
          <View style={styles.iconButton}>
            <Check size={20} color={colors.primary} />
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('debts.markPaid')}
            onPress={onPay}
            hitSlop={8}
            style={styles.payButton}
          >
            <ArrowRight size={18} color={colors.primaryDark} />
          </Pressable>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  sectionOverline: {
    ...typography.label,
    color: colors.textSecondary,
  },
  totalOwed: {
    ...typography.display,
    color: colors.primaryDark,
    marginTop: spacing.xs,
  },
  totalLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  sectionWrap: {
    marginTop: spacing.lg,
    gap: spacing.md,
  },
  sectionLabel: {
    ...typography.label,
    color: colors.textMuted,
  },
  rowContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  avatarPaid: {
    backgroundColor: colors.surfaceAlt,
  },
  avatarText: {
    ...typography.heading,
    color: colors.primaryDark,
  },
  rowText: {
    flex: 1,
    marginRight: spacing.sm,
  },
  rowName: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  rowMuted: {
    color: colors.textMuted,
  },
  rowMeta: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  rowAmount: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  payButton: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
  },
  iconButton: {
    padding: spacing.sm,
    marginLeft: spacing.xs,
  },
});

export { DebtRow };