import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  HandCoins,
  type LucideIcon,
} from 'lucide-react-native';
import Screen from '../../components/ui/Screen';
import KaziLogo from '../../components/brand/KaziLogo';
import Card from '../../components/ui/Card';
import { useAuth } from '../../auth/AuthContext';
import { fetchSummary, listItems } from '../../offline/api';
import type { MoneySummary } from '../../summary/api';
import { formatMoney } from '../../money/format';
import type { MainTabParamList } from '../../navigation/RootNavigator';
import { colors, radius, spacing, typography } from '../../theme';

type Navigation = BottomTabNavigationProp<MainTabParamList>;

interface QuickAction {
  key: string;
  labelKey: string;
  icon: LucideIcon;
  tone: string;
  onPress: (navigation: Navigation) => void;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    key: 'sale',
    labelKey: 'home.recordSale',
    icon: ArrowUpRight,
    tone: colors.success,
    onPress: navigation =>
      navigation.navigate('History', {
        screen: 'TransactionForm',
        params: { initialType: 'sale' },
      }),
  },
  {
    key: 'expense',
    labelKey: 'home.recordExpense',
    icon: ArrowDownLeft,
    tone: colors.error,
    onPress: navigation =>
      navigation.navigate('History', {
        screen: 'TransactionForm',
        params: { initialType: 'purchase' },
      }),
  },
  {
    key: 'debts',
    labelKey: 'home.moneyOwed',
    icon: HandCoins,
    tone: colors.warning,
    onPress: navigation => navigation.navigate('History', { screen: 'Debts' }),
  },
  {
    key: 'capital',
    labelKey: 'home.addCapital',
    icon: Banknote,
    tone: colors.primary,
    onPress: navigation => navigation.navigate('History', { screen: 'AddMoney' }),
  },
];

export default function HomeScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Navigation>();
  const { user } = useAuth();
  const [summary, setSummary] = useState<MoneySummary | null>(null);
  const [hasAnyActivity, setHasAnyActivity] = useState(false);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [checked, setChecked] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const [summaryResult, itemsResult] = await Promise.all([fetchSummary(), listItems()]);
      setSummary(summaryResult.summary);
      setHasAnyActivity(
        summaryResult.summary.totalReceived > 0 || summaryResult.summary.totalSpent > 0,
      );
      setLowStockCount(
        itemsResult.items.filter(item => item.trackStock && item.lowStock).length,
      );
    } catch {
      setLowStockCount(0);
      setLoadFailed(true);
    } finally {
      setChecked(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const greetingKey = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) {
      return 'home.greetingMorning';
    }
    if (hour < 18) {
      return 'home.greetingAfternoon';
    }
    return 'home.greetingEvening';
  }, []);

  const firstName = user?.firstName?.trim() || '';

  return (
    <Screen>
      <KaziLogo markSize={40} textSize={24} />
      <View style={styles.content}>
        <Text style={styles.greeting}>
          {t(greetingKey, { name: firstName || t('home.businessOwner') })}
        </Text>

        {checked && loadFailed ? (
          <Pressable
            accessibilityRole="button"
            onPress={load}
            style={styles.retryRow}
          >
            <Text style={styles.retryText}>{t('common.error.offline')}</Text>
            <Text style={styles.retryCta}>{t('common.retry')}</Text>
          </Pressable>
        ) : null}

        <Card>
          {summary ? (
            <View>
              <View style={styles.metricGroup}>
                <View style={styles.metric}>
                  <Text style={styles.metricLabel}>{t('home.moneyReceived')}</Text>
                  <Text style={[styles.metricValue, { color: colors.success }]}>
                    +{formatMoney(summary.todayReceived)}
                  </Text>
                </View>
                <View style={styles.metric}>
                  <Text style={styles.metricLabel}>{t('home.moneySpent')}</Text>
                  <Text style={[styles.metricValue, { color: colors.error }]}>
                    −{formatMoney(summary.todaySpent)}
                  </Text>
                </View>
                <View style={styles.metricDivider} />
                <View style={styles.metricWide}>
                  <Text style={styles.metricLabel}>{t('home.moneyMade')}</Text>
                  <Text style={styles.metricNet}>
                    {summary.todayNet < 0 ? '' : '+'}
                    {formatMoney(summary.todayNet)}
                  </Text>
                </View>
              </View>
              <Text style={styles.todayLabel}>{t('home.today')}</Text>
            </View>
          ) : !checked && !loadFailed ? (
            <Text style={styles.loadingText}>{t('common.loading')}</Text>
          ) : null}
        </Card>

        {checked && !hasAnyActivity && !loadFailed ? (
          <Text style={styles.welcomeMessage}>{t('home.firstHint')}</Text>
        ) : null}

        <View style={styles.actionsGrid}>
          {QUICK_ACTIONS.map(action => (
            <Pressable
              key={action.key}
              testID={`home-action-${action.key}`}
              accessibilityRole="button"
              onPress={() => action.onPress(navigation)}
              style={({ pressed }) => [
                styles.actionCard,
                pressed && styles.actionPressed,
              ]}
            >
              <View style={[styles.actionIcon, { backgroundColor: action.tone }]}>
                <action.icon size={22} color={colors.textOnPrimary} strokeWidth={2.2} />
              </View>
              <Text style={styles.actionLabel}>{t(action.labelKey)}</Text>
            </Pressable>
          ))}
        </View>

        {checked && lowStockCount > 0 ? (
          <View style={styles.alertCard}>
            <View style={styles.alertIconWrap}>
              <AlertTriangle size={22} color={colors.warning} />
            </View>
            <View style={styles.alertTextWrap}>
              <Text style={styles.alertTitle}>{t('home.lowStockTitle')}</Text>
              <Text style={styles.alertMessage}>
                {t('home.lowStockSummary', { count: lowStockCount })}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => navigation.navigate('Products')}
            >
              <Text style={styles.viewProducts}>{t('home.viewProducts')}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    marginTop: spacing.xl,
    gap: spacing.lg,
  },
  greeting: {
    ...typography.title,
    color: colors.textPrimary,
  },
  retryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  retryText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  retryCta: {
    ...typography.caption,
    color: colors.primaryDark,
    fontWeight: '700',
  },
  metricGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metric: {
    flex: 1,
  },
  metricWide: {
    flex: 1.4,
  },
  metricDivider: {
    width: 1,
    height: 40,
    backgroundColor: colors.border,
    marginHorizontal: spacing.md,
  },
  metricLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  metricValue: {
    ...typography.heading,
    color: colors.textPrimary,
    marginTop: 2,
  },
  metricNet: {
    ...typography.display,
    color: colors.primaryDark,
    marginTop: 2,
  },
  metricNetNegative: {
    color: colors.error,
  },
  todayLabel: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.md,
    textAlign: 'right',
  },
  loadingText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  welcomeMessage: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  actionCard: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    top: 0,
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionPressed: {
    opacity: 0.85,
  },
  actionIcon: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    ...typography.heading,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  alertCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.warningSoft,
    padding: spacing.lg,
    gap: spacing.md,
  },
  alertIconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.warningSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertTextWrap: {
    flex: 1,
  },
  alertTitle: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  alertMessage: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  viewProducts: {
    ...typography.label,
    color: colors.primaryDark,
    fontWeight: '700',
  },
});