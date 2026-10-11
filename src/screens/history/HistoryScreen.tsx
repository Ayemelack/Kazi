import React, { useCallback, useRef, useState } from 'react';
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
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import DatePickerField from '../../components/ui/DatePickerField';
import EmptyState from '../../components/ui/EmptyState';
import ErrorState from '../../components/ui/ErrorState';
import { errorMessage } from '../../errors/messages';
import LoadingView from '../../components/ui/LoadingView';
import { useToast } from '../../components/ui/Toast';
import { listActivity } from '../../offline/api';
import type { ActivitySummary, ActivityType, HistoryPeriod } from '../../activity/types';
import type { LocalActivity } from '../../offline/types';
import { todayAsDateString } from '../../transactions/validation';
import { HISTORY_PAGE_SIZE, formatMoney } from '@kazi/shared';
import type { HistoryStackParamList } from '../../navigation/RootNavigator';
import { colors, radius, spacing, typography } from '../../theme';

type ScreenProps = NativeStackScreenProps<HistoryStackParamList, 'HistoryList'>;

type RecordOption = 'sale' | 'expense' | 'capital' | 'debt';

type PeriodOption = Exclude<HistoryPeriod, 'all'>;

const PERIODS: PeriodOption[] = ['today', 'yesterday', 'this_week', 'older'];

const PERIOD_LABEL_KEY: Record<PeriodOption, string> = {
  today: 'history.periods.today',
  yesterday: 'history.periods.yesterday',
  this_week: 'history.periods.thisWeek',
  older: 'history.periods.older',
};

const PAGE_SIZE = HISTORY_PAGE_SIZE;

const RECORD_OPTIONS: { key: RecordOption; labelKey: string; icon: React.ReactNode }[] = [
  { key: 'sale', labelKey: 'history.recordSale', icon: <ArrowUpRight size={20} color={colors.success} /> },
  { key: 'expense', labelKey: 'history.recordExpense', icon: <ArrowDownLeft size={20} color={colors.error} /> },
  { key: 'capital', labelKey: 'history.recordCapital', icon: <Banknote size={20} color={colors.primary} /> },
  { key: 'debt', labelKey: 'history.recordDebt', icon: <HandCoins size={20} color={colors.warning} /> },
];

export default function HistoryScreen({ navigation }: ScreenProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [period, setPeriod] = useState<PeriodOption>('today');
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [events, setEvents] = useState<LocalActivity[]>([]);
  const [summary, setSummary] = useState<ActivitySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // A date range under "Older" replaces the period filter: the server always
  // honours an explicit range over a preset period.
  const hasRange = period === 'older' && (rangeFrom !== '' || rangeTo !== '');

  // Changing period or range starts a new request while the previous one may
  // still be in flight; the newest one wins and older responses are dropped
  // instead of overwriting the list with the wrong period's data.
  const requestIdRef = useRef(0);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'more', nextOffset = 0) => {
      const requestId = (requestIdRef.current += 1);
      const isCurrent = () => requestId === requestIdRef.current;

      // Anything older is now obsolete, so hand the spinner over to this call
      // rather than letting a stale response clear it.
      setLoading(mode === 'initial');
      setRefreshing(mode === 'refresh');
      setLoadingMore(mode === 'more');
      if (mode !== 'more') {
        setError(null);
      }
      try {
        const result = await listActivity({
          period: hasRange ? undefined : period,
          startDate: hasRange ? rangeFrom || undefined : undefined,
          endDate: hasRange ? rangeTo || undefined : undefined,
          asOf: todayAsDateString(),
          limit: PAGE_SIZE,
          offset: nextOffset,
        });
        if (!isCurrent()) {
          return;
        }
        setEvents(prev => (nextOffset === 0 ? result.events : [...prev, ...result.events]));
        setSummary(result.summary);
        setHasMore(result.hasMore);
      } catch (err) {
        if (!isCurrent()) {
          return;
        }
        if (mode === 'more') {
          toast.show('error', errorMessage(err, t));
        } else {
          setError(err);
        }
      } finally {
        if (isCurrent()) {
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
        }
      }
    },
    [period, rangeFrom, rangeTo, hasRange, t, toast],
  );

  useFocusEffect(
    useCallback(() => {
      load('initial');
    }, [load]),
  );

  const selectPeriod = (next: PeriodOption) => {
    if (next === period) {
      return;
    }
    setPeriod(next);
    if (next !== 'older') {
      setRangeFrom('');
      setRangeTo('');
    }
  };

  const clearRange = () => {
    setRangeFrom('');
    setRangeTo('');
  };

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

  const filters = (
    <>
      <PeriodChips selected={period} onSelect={selectPeriod} />
      {period === 'older' ? (
        <View style={styles.rangeRow}>
          <View style={styles.rangeField}>
            <DatePickerField
              testID="history-range-from"
              label={t('history.rangeFrom')}
              value={rangeFrom || t('history.rangeNotSet')}
              onChange={setRangeFrom}
            />
          </View>
          <View style={styles.rangeField}>
            <DatePickerField
              testID="history-range-to"
              label={t('history.rangeTo')}
              value={rangeTo || t('history.rangeNotSet')}
              onChange={setRangeTo}
            />
          </View>
          {hasRange ? (
            <Pressable
              testID="history-clear-range"
              accessibilityRole="button"
              onPress={clearRange}
              hitSlop={8}
              style={styles.clearRange}
            >
              <Text style={styles.clearRangeText}>{t('history.clearRange')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </>
  );

  const today = todayAsDateString();
  const yesterday = shiftDay(today, -1);
  const groups = groupByDay(events, t, today, yesterday);

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
        <ErrorState message={errorMessage(error, t)} onRetry={() => load('initial')} />
      ) : events.length === 0 ? (
        <View style={styles.emptyWrap}>
          {filters}
          {summary ? <PeriodSummary summary={summary} /> : null}
          <EmptyState
            icon={History}
            title={t('history.emptyTitle')}
            message={t('history.emptyMessage')}
            actionLabel={t('history.emptyAction')}
            onAction={() => setSheetOpen(true)}
          />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} />
          }
          showsVerticalScrollIndicator={false}
        >
          {filters}
          {summary ? <PeriodSummary summary={summary} /> : null}
          {groups.map(group => (
            <View key={group.key} style={styles.group}>
              <Text style={styles.groupHeader}>{group.label}</Text>
              <View style={styles.groupRows}>
                {group.events.map(event => (
                  <ActivityRow key={event.id} event={event} />
                ))}
              </View>
            </View>
          ))}
          {hasMore ? (
            <Button
              testID="history-load-more"
              label={t('history.loadMore')}
              variant="outline"
              size="md"
              loading={loadingMore}
              disabled={loadingMore}
              onPress={() => load('more', events.length)}
            />
          ) : null}
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

function PeriodChips({
  selected,
  onSelect,
}: {
  selected: PeriodOption;
  onSelect: (period: PeriodOption) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.chipRow}>
      {PERIODS.map(option => {
        const active = selected === option;
        return (
          <Pressable
            key={option}
            testID={`history-period-${option}`}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(option)}
            style={[styles.chip, active ? styles.chipActive : styles.chipInactive]}
          >
            <Text
              numberOfLines={1}
              style={[styles.chipText, { color: active ? colors.primaryDark : colors.textSecondary }]}
            >
              {t(PERIOD_LABEL_KEY[option])}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function PeriodSummary({ summary }: { summary: ActivitySummary }) {
  const { t } = useTranslation();
  return (
    <Card>
      <View style={styles.summaryRow}>
        <View style={styles.summaryMetric}>
          <Text style={styles.summaryLabel}>{t('history.summaryReceived')}</Text>
          <Text style={[styles.summaryValue, { color: colors.success }]}>
            +{formatMoney(summary.received)}
          </Text>
        </View>
        <View style={styles.summaryMetric}>
          <Text style={styles.summaryLabel}>{t('history.summarySpent')}</Text>
          <Text style={[styles.summaryValue, { color: colors.error }]}>
            −{formatMoney(summary.spent)}
          </Text>
        </View>
        <View style={styles.summaryMetric}>
          <Text style={styles.summaryLabel}>{t('history.summaryMade')}</Text>
          <Text
            style={[
              styles.summaryValue,
              { color: summary.made < 0 ? colors.error : colors.textPrimary },
            ]}
          >
            {summary.made < 0 ? '' : '+'}
            {formatMoney(summary.made)}
          </Text>
        </View>
      </View>
      {summary.capital > 0 ? (
        <View style={styles.summaryCapital}>
          <Text style={styles.summaryLabel}>{t('history.summaryCapital')}</Text>
          <Text style={styles.summaryCapitalValue}>{formatMoney(summary.capital)}</Text>
        </View>
      ) : null}
    </Card>
  );
}

interface DayGroup {
  key: string;
  label: string;
  events: LocalActivity[];
}

// The server already returns events ordered by business day, newest first, so
// a day only ever starts at a row whose date differs from the previous one.
function groupByDay(
  events: LocalActivity[],
  t: (key: string) => string,
  today: string,
  yesterday: string,
): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const event of events) {
    const key = event.eventDate ?? event.createdAt.slice(0, 10);
    const current = groups[groups.length - 1];
    if (current && current.key === key) {
      current.events.push(event);
      continue;
    }
    groups.push({ key, label: dayLabel(key, t, today, yesterday), events: [event] });
  }
  return groups;
}

function dayLabel(
  key: string,
  t: (key: string) => string,
  today: string,
  yesterday: string,
): string {
  if (key === today) {
    return t('history.dayToday');
  }
  if (key === yesterday) {
    return t('history.dayYesterday');
  }
  const parsed = new Date(`${key}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? key : parsed.toLocaleDateString();
}

function shiftDay(value: string, days: number): string {
  const [year = 0, month = 1, day = 1] = value
    .split('-')
    .map(part => Number(part));
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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
  emptyWrap: {
    flex: 1,
    gap: spacing.md,
  },
  chipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  chip: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  chipInactive: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  chipText: {
    ...typography.caption,
    fontWeight: '600',
  },
  rangeRow: {
    gap: spacing.xs,
  },
  rangeField: {
    marginBottom: spacing.sm,
  },
  clearRange: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
  },
  clearRangeText: {
    ...typography.caption,
    color: colors.primaryDark,
    fontWeight: '600',
  },
  summaryRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  summaryMetric: {
    flex: 1,
  },
  summaryLabel: {
    ...typography.label,
    color: colors.textSecondary,
  },
  summaryValue: {
    ...typography.heading,
    marginTop: spacing.xs,
  },
  summaryCapital: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.md,
    paddingTop: spacing.md,
  },
  summaryCapitalValue: {
    ...typography.body,
    color: colors.primaryDark,
    fontWeight: '600',
  },
  group: {
    gap: spacing.sm,
  },
  groupHeader: {
    ...typography.label,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  groupRows: {
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
