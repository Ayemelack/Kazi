import React, { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Bell, Clock } from 'lucide-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import Screen from '../../components/ui/Screen';
import AppHeader from '../../components/ui/AppHeader';
import Card from '../../components/ui/Card';
import { useToast } from '../../components/ui/Toast';
import {
  DEFAULT_REMINDER_SETTINGS,
  applyDailyReminder,
  loadReminderSettings,
  type ReminderSettings,
} from '../../notifications/reminder';
import { requestNotificationPermission } from '../../notifications/service';
import { buildDailyReminderContent } from '../../notifications/reminderContent';
import type { MoreStackParamList } from '../../navigation/RootNavigator';
import { colors, radius, spacing, typography } from '../../theme';

type ScreenProps = NativeStackScreenProps<MoreStackParamList, 'Reminder'>;

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [0, 15, 30, 45];

function formatTime(value: number): string {
  return String(value).padStart(2, '0');
}

export default function ReminderScreen({ navigation }: ScreenProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [settings, setSettings] = useState<ReminderSettings>(DEFAULT_REMINDER_SETTINGS);
  const [ready, setReady] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [saving, setSaving] = useState(false);

  const content = useCallback(() => buildDailyReminderContent(t), [t]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await loadReminderSettings();
      if (cancelled) return;
      setSettings(loaded);
      if (loaded.enabled) {
        // Keep the saved reminder in sync with the current time, language and
        // the latest figures the API gave us.
        await applyDailyReminder(loaded, await content()).catch(() => {});
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [content]);

  const persist = useCallback(
    async (next: ReminderSettings) => {
      setSettings(next);
      setSaving(true);
      try {
        await applyDailyReminder(next, await content());
      } catch {
        toast.show('error', t('reminder.saveError'));
      } finally {
        setSaving(false);
      }
    },
    [content, t, toast],
  );

  const toggle = useCallback(
    async (value: boolean) => {
      if (!value) {
        setPermissionDenied(false);
        await persist({ ...settings, enabled: false });
        return;
      }
      const granted = await requestNotificationPermission();
      if (!granted) {
        setPermissionDenied(true);
        return;
      }
      setPermissionDenied(false);
      await persist({ ...settings, enabled: true });
    },
    [persist, settings],
  );

  const time = `${formatTime(settings.hour)}:${formatTime(settings.minute)}`;

  return (
    <Screen scroll>
      <AppHeader title={t('more.reminder')} onBack={() => navigation.goBack()} />

      <View style={styles.content}>
        <Card>
          <View style={styles.toggleRow}>
            <View style={styles.toggleIcon}>
              <Bell size={20} color={colors.primaryDark} />
            </View>
            <View style={styles.toggleText}>
              <Text style={styles.title}>{t('reminder.title')}</Text>
              <Text style={styles.description}>{t('reminder.description')}</Text>
            </View>
            <Switch
              testID="reminder-toggle"
              accessibilityLabel={t('reminder.title')}
              value={settings.enabled}
              onValueChange={toggle}
              disabled={!ready || saving}
              trackColor={{ false: colors.disabled, true: colors.primary }}
              thumbColor={colors.surface}
            />
          </View>
        </Card>

        {permissionDenied ? (
          <Text testID="reminder-permission" style={styles.permission}>
            {t('reminder.permissionDenied')}
          </Text>
        ) : null}

        {settings.enabled ? (
          <Card>
            <View style={styles.timeHeader}>
              <Clock size={18} color={colors.primaryDark} />
              <Text style={styles.sectionLabel}>{t('reminder.timeLabel')}</Text>
              <Text testID="reminder-time" style={styles.timeValue}>
                {time}
              </Text>
            </View>

            <Text style={styles.pickerLabel}>{t('reminder.hour')}</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              {HOURS.map(hour => {
                const active = settings.hour === hour;
                return (
                  <Pressable
                    key={hour}
                    testID={`reminder-hour-${hour}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => persist({ ...settings, hour })}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {formatTime(hour)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Text style={styles.pickerLabel}>{t('reminder.minute')}</Text>
            <View style={styles.chipRow}>
              {MINUTES.map(minute => {
                const active = settings.minute === minute;
                return (
                  <Pressable
                    key={minute}
                    testID={`reminder-minute-${minute}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => persist({ ...settings, minute })}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {formatTime(minute)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Card>
        ) : null}

        <Text style={styles.note}>{t('reminder.note')}</Text>
      </View>
    </Screen>
  );
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
  title: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  description: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  permission: {
    ...typography.body,
    color: colors.error,
  },
  timeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  sectionLabel: {
    ...typography.label,
    color: colors.textSecondary,
    marginLeft: spacing.sm,
    flex: 1,
  },
  timeValue: {
    ...typography.title,
    color: colors.primaryDark,
  },
  pickerLabel: {
    ...typography.label,
    color: colors.textMuted,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  chipRow: {
    gap: spacing.sm,
  },
  chip: {
    minWidth: 48,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  chipTextActive: {
    color: colors.textOnPrimary,
    fontWeight: '600',
  },
  note: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
});
