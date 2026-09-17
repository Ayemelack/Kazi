import React, { useCallback, useState } from 'react';
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  HandCoins,
  History,
  Package,
  Plus,
  X,
} from 'lucide-react-native';
import Screen from '../../components/ui/Screen';
import AppHeader from '../../components/ui/AppHeader';
import Card from '../../components/ui/Card';
import EmptyState from '../../components/ui/EmptyState';
import ErrorState from '../../components/ui/ErrorState';
import LoadingView from '../../components/ui/LoadingView';
import { listActivity } from '../../offline/api';
import type { ActivityType } from '../../activity/types';
import type { LocalActivity } from '../../offline/types';
import { formatMoney } from '../../money/format';
import type { HistoryStackParamList } from '../../navigation/RootNavigator';
import { colors, radius, spacing, typography } from '../../theme';

type ScreenProps = NativeStackScreenProps<HistoryStackParamList, 'HistoryList'>;

type RecordOption = 'sale' | 'expense' | 'capital' | 'debt';

const RECORD_OPTIONS: { key: RecordOption; labelKey: string; icon: React.ReactNode }[] = [
  { key: 'sale', labelKey: 'history.recordSale', icon: <ArrowUpRight size={20} color={colors.success} /> },
  { key: 'expense', labelKey: 'history.recordExpense', icon: <ArrowDownLeft size={20} color={colors.error} /> },
  { key: 'capital', labelKey: 'history.recordCapital', icon: <Banknote size={20} color={colors.primary} /> },
  { key: 'debt', labelKey: 'history.recordDebt', icon: <HandCoins size={20} color={colors.warning} /> },
];

export default function HistoryScreen({ navigation }: ScreenProps) {
  const { t } = useTranslation();
  const [events, setEvents] = useState<LocalActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (mode === 'initial') {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);
      try {
        const result = await listActivity(100);
        setEvents(result.events);
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

  const choose = (option: RecordOption) => {
    setSheetOpen(false);
    switch (option) {
      case 'sale':
        navigation.navigate('TransactionForm', { initialType: 'sale' });
        return;
      case 'expense':
        navigation.navigate('TransactionForm', { initialType: 'purchase' });
        return;
      case 'capital':
        navigation.navigate('AddMoney');
        return;
      case 'debt':
        navigation.navigate('DebtForm');
        return;
    }
  };

  return (
    <Screen>
      <AppHeader
        title={t('navigation.history')}
        rightIcon={Plus}
        onRightPress={() => setSheetOpen(true)}
      />
      {loading ? (
        <LoadingView />
      ) : error ? (
        <ErrorState message={error} onRetry={() => load('initial')} />
      ) : events.length === 0 ? (
        <EmptyState
          icon={History}
          title={t('history.emptyTitle')}
          message={t('history.emptyMessage')}
          actionLabel={t('history.emptyAction')}
          onAction={() => setSheetOpen(true)}
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} />
          }
          showsVerticalScrollIndicator={false}
        >
          {events.map(event => (
            <ActivityRow key={event.id} event={event} />
          ))}
        </ScrollView>
      )}

      <ActionSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onChoose={choose}
      />
    </Screen>
  );
}

function ActivityRow({ event }: { event: LocalActivity }) {
  const { t } = useTranslation();
  const config = typeLookup[event.type];
  const Icon = config.icon;

  const title = event.title ? ` — ${event.title}` : '';
  const quantity = event.quantity ? ` ×${event.quantity}` : '';
  const pending = event.syncStatus !== 'synced';

  return (
    <Card>
      <View style={styles.rowContent}>
        <View style={[styles.iconWrap, { backgroundColor: config.bg }]}>
          <Icon size={20} color={config.color} />
        </View>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {config.label(t)}
            {title}
            {quantity}
          </Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {event.eventDate ?? formatDay(event.createdAt)}
          </Text>
          {pending ? (
            <Text style={styles.pendingBadge} numberOfLines={1}>
              {t('offline.waitingToSync')}
            </Text>
          ) : null}
        </View>
        {event.amount !== undefined ? (
          <Text style={[styles.rowAmount, { color: config.color }]}>
            {config.sign}
            {formatMoney(event.amount)}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

interface TypeConfig {
  icon: (typeof ArrowUpRight);
  color: string;
  bg: string;
  sign: string;
  label: (t: (key: string) => string) => string;
}

const typeLookup: Record<ActivityType, TypeConfig> = {
  sale: {
    icon: ArrowUpRight,
    color: colors.success,
    bg: colors.successSoft,
    sign: '+',
    label: t => t('history.labels.sale'),
  },
  spend: {
    icon: ArrowDownLeft,
    color: colors.error,
    bg: colors.errorSoft,
    sign: '−',
    label: t => t('history.labels.spend'),
  },
  capital: {
    icon: Banknote,
    color: colors.primary,
    bg: colors.primarySoft,
    sign: '+',
    label: t => t('history.labels.capital'),
  },
  debt_added: {
    icon: HandCoins,
    color: colors.warning,
    bg: colors.warningSoft,
    sign: '',
    label: t => t('history.labels.debtAdded'),
  },
  debt_paid: {
    icon: HandCoins,
    color: colors.success,
    bg: colors.successSoft,
    sign: '',
    label: t => t('history.labels.debtPaid'),
  },
  product_added: {
    icon: Package,
    color: colors.primary,
    bg: colors.primarySoft,
    sign: '',
    label: t => t('history.labels.productAdded'),
  },
  product_updated: {
    icon: Package,
    color: colors.primary,
    bg: colors.primarySoft,
    sign: '',
    label: t => t('history.labels.productUpdated'),
  },
};

function formatDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleDateString();
}

function ActionSheet({
  visible,
  onClose,
  onChoose,
}: {
  visible: boolean;
  onClose: () => void;
  onChoose: (option: RecordOption) => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button">
        <View style={styles.sheet} onStartShouldSetResponder={() => true}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{t('history.recordTitle')}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              hitSlop={8}
              style={styles.sheetClose}
            >
              <X size={22} color={colors.textSecondary} />
            </Pressable>
          </View>
          {RECORD_OPTIONS.map(option => (
            <Pressable
              key={option.key}
              testID={`action-${option.key}`}
              accessibilityRole="button"
              onPress={() => onChoose(option.key)}
              style={({ pressed }) => [styles.actionRow, pressed && styles.actionPressed]}
            >
              <View style={styles.actionIcon}>{option.icon}</View>
              <Text style={styles.actionLabel}>{t(option.labelKey)}</Text>
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  rowContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  rowText: {
    flex: 1,
    marginRight: spacing.sm,
  },
  rowTitle: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  rowMeta: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  pendingBadge: {
    ...typography.caption,
    color: colors.warning,
    fontWeight: '600',
    marginTop: 2,
    alignSelf: 'flex-start',
  },
  rowAmount: {
    ...typography.heading,
  },
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
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  sheetTitle: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  sheetClose: {
    position: 'absolute',
    right: 0,
    padding: spacing.xs,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionPressed: {
    opacity: 0.85,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  actionLabel: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '600',
  },
});