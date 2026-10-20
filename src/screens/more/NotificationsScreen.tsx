import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Bell, ChevronRight, Inbox } from 'lucide-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { PUSH_TYPE_LOW_STOCK } from '@kazi/shared';
import Screen from '../../components/ui/Screen';
import AppHeader from '../../components/ui/AppHeader';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import EmptyState from '../../components/ui/EmptyState';
import { useToast } from '../../components/ui/Toast';
import { errorMessage } from '../../errors/messages';
import {
  fetchNotifications,
  fetchPushPreferences,
  markAllNotificationsRead,
  savePushPreferences,
  type NotificationItem,
} from '../../notifications/api';
import { handlePushOpened } from '../../notifications/pushNavigation';
import type { MoreStackParamList } from '../../navigation/RootNavigator';
import { colors, radius, spacing, typography } from '../../theme';

type ScreenProps = NativeStackScreenProps<MoreStackParamList, 'Notifications'>;

/**
 * More > Notifications: the account's push switch and the history of what was
 * actually delivered. The switch is the server's (every sender reads it
 * before calling FCM); the list is this account's, so a tap on an item alert
 * opens that item through the same route a pushed tap uses.
 */
export default function NotificationsScreen({ navigation }: ScreenProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [pushEnabled, setPushEnabled] = useState<boolean | null>(null);
  const [inactivityEnabled, setInactivityEnabled] = useState(false);
  const [preferencesError, setPreferencesError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [historyError, setHistoryError] = useState<unknown>(null);
  const [marking, setMarking] = useState(false);

  const loadPreferences = useCallback(async () => {
    setPreferencesError(null);
    try {
      const result = await fetchPushPreferences();
      setPushEnabled(result.pushNotifications);
      setInactivityEnabled(result.inactivityNotifications);
    } catch (err) {
      setPreferencesError(err);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryError(null);
    try {
      const result = await fetchNotifications();
      setItems(result.notifications);
    } catch (err) {
      setHistoryError(err);
    }
  }, []);

  useEffect(() => {
    loadPreferences();
    loadHistory();
  }, [loadPreferences, loadHistory]);

  const togglePush = useCallback(
    async (value: boolean) => {
      if (pushEnabled === null || saving) {
        return;
      }
      setSaving(true);
      try {
        // Send the current inactivity value so turning the master switch off
        // and on again never silently changes the opt-in choice.
        const result = await savePushPreferences(value, inactivityEnabled);
        setPushEnabled(result.pushNotifications);
        setInactivityEnabled(result.inactivityNotifications);
        toast.show('success', t('notifications.saved'));
      } catch (err) {
        toast.show('error', errorMessage(err, t));
      } finally {
        setSaving(false);
      }
    },
    [pushEnabled, inactivityEnabled, saving, t, toast],
  );

  const toggleInactivity = useCallback(
    async (value: boolean) => {
      if (pushEnabled !== true || saving) {
        return;
      }
      setSaving(true);
      try {
        const result = await savePushPreferences(true, value);
        setPushEnabled(result.pushNotifications);
        setInactivityEnabled(result.inactivityNotifications);
        toast.show('success', t('notifications.saved'));
      } catch (err) {
        toast.show('error', errorMessage(err, t));
      } finally {
        setSaving(false);
      }
    },
    [pushEnabled, saving, t, toast],
  );

  const markAll = useCallback(async () => {
    if (marking) {
      return;
    }
    setMarking(true);
    try {
      await markAllNotificationsRead();
      setItems(current => (current === null ? current : current.map(item => ({ ...item, read: true }))));
      toast.show('success', t('notifications.markedRead'));
    } catch (err) {
      toast.show('error', errorMessage(err, t));
    } finally {
      setMarking(false);
    }
  }, [marking, t, toast]);

  const unread = (items ?? []).filter(item => !item.read).length;

  const openNotification = (item: NotificationItem) => {
    // Only a typed push has a screen to open; a plain message is display-only.
    if (item.type !== PUSH_TYPE_LOW_STOCK) {
      return;
    }
    handlePushOpened({
      title: item.title,
      body: item.body,
      type: PUSH_TYPE_LOW_STOCK,
      itemId: item.itemId,
    });
  };

  return (
    <Screen scroll>
      <AppHeader title={t('more.notifications')} onBack={() => navigation.goBack()} />

      <View style={styles.content}>
        <Card>
          <View style={styles.toggleRow}>
            <View style={styles.toggleIcon}>
              <Bell size={20} color={colors.primaryDark} />
            </View>
            <View style={styles.toggleText}>
              <Text style={styles.title}>{t('notifications.pushLabel')}</Text>
              <Text style={styles.description}>{t('notifications.pushDescription')}</Text>
            </View>
            <Switch
              testID="push-toggle"
              accessibilityLabel={t('notifications.pushLabel')}
              value={pushEnabled === true}
              onValueChange={value => togglePush(value)}
              disabled={pushEnabled === null || saving}
              trackColor={{ false: colors.disabled, true: colors.primary }}
              thumbColor={colors.surface}
            />
          </View>

          <View style={styles.divider} />

          <View style={styles.toggleRow}>
            <View style={styles.toggleIcon}>
              <Bell size={20} color={colors.primaryDark} />
            </View>
            <View style={styles.toggleText}>
              <Text style={styles.title}>{t('notifications.inactivityLabel')}</Text>
              <Text style={styles.description}>
                {pushEnabled === false
                  ? t('notifications.inactivityDisabledHint')
                  : t('notifications.inactivityDescription')}
              </Text>
            </View>
            <Switch
              testID="inactivity-toggle"
              accessibilityLabel={t('notifications.inactivityLabel')}
              value={inactivityEnabled === true}
              onValueChange={value => toggleInactivity(value)}
              disabled={pushEnabled !== true || saving}
              trackColor={{ false: colors.disabled, true: colors.primary }}
              thumbColor={colors.surface}
            />
          </View>

          {preferencesError !== null ? (
            <View style={styles.inlineError}>
              <Text style={styles.inlineErrorText}>{errorMessage(preferencesError, t)}</Text>
              <Button
                label={t('common.retry')}
                variant="outline"
                size="md"
                testID="push-retry"
                onPress={() => loadPreferences()}
              />
            </View>
          ) : null}
        </Card>

        <Card>
          <View style={styles.historyHeader}>
            <Text style={styles.sectionTitle}>{t('notifications.historyTitle')}</Text>
            {unread > 0 ? (
              <Button
                label={t('notifications.markAllRead')}
                variant="ghost"
                size="md"
                loading={marking}
                testID="notifications-mark-all"
                onPress={() => markAll()}
              />
            ) : null}
          </View>

          {items === null && historyError === null ? (
            <View style={styles.stateBox}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.stateText}>{t('common.loading')}</Text>
            </View>
          ) : historyError !== null ? (
            <View style={styles.stateBox}>
              <Text style={styles.stateText}>{errorMessage(historyError, t)}</Text>
              <Button
                label={t('common.retry')}
                variant="outline"
                size="md"
                testID="notifications-retry"
                onPress={() => loadHistory()}
              />
            </View>
          ) : (items ?? []).length === 0 ? (
            <View style={styles.stateBox}>
              <EmptyState
                icon={Inbox}
                title={t('notifications.emptyTitle')}
                message={t('notifications.emptyMessage')}
              />
            </View>
          ) : (
            <View style={styles.list}>
              {(items ?? []).map(item => {
                const row = (
                  <View style={styles.row}>
                    <View style={[styles.rowDot, item.read && styles.rowDotRead]} />
                    <View style={styles.rowText}>
                      <Text
                        style={[styles.rowTitle, !item.read && styles.rowTitleUnread]}
                        numberOfLines={1}
                      >
                        {item.title}
                      </Text>
                      <Text style={styles.rowBody} numberOfLines={2}>
                        {item.body}
                      </Text>
                      <Text style={styles.rowTime}>{formatWhen(item.createdAt)}</Text>
                    </View>
                    {item.type === PUSH_TYPE_LOW_STOCK ? (
                      <ChevronRight size={18} color={colors.textMuted} />
                    ) : null}
                  </View>
                );
                if (item.type !== PUSH_TYPE_LOW_STOCK) {
                  return (
                    <View key={item.id} testID={`notification-${item.id}`}>
                      {row}
                    </View>
                  );
                }
                return (
                  <Pressable
                    key={item.id}
                    testID={`notification-${item.id}`}
                    accessibilityRole="button"
                    onPress={() => openNotification(item)}
                    style={({ pressed }) => pressed && styles.rowPressed}
                  >
                    {row}
                  </Pressable>
                );
              })}
            </View>
          )}
        </Card>
      </View>
    </Screen>
  );
}

// The server stores UTC ("2026-10-18 12:34:56"); the owner reads local time.
function formatWhen(value: string): string {
  const parsed = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

const styles = StyleSheet.create({
  content: {
    marginTop: spacing.md,
    gap: spacing.md,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  toggleIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  toggleText: {
    flex: 1,
    marginRight: spacing.md,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  title: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  description: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  inlineError: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  inlineErrorText: {
    ...typography.body,
    color: colors.error,
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.textMuted,
  },
  stateBox: {
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  stateText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  list: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  rowPressed: {
    opacity: 0.85,
  },
  rowDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  rowDotRead: {
    backgroundColor: colors.border,
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    ...typography.body,
    color: colors.textSecondary,
  },
  rowTitleUnread: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  rowBody: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  rowTime: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
});
