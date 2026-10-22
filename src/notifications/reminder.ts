import notifee, {
  AndroidImportance,
  AndroidVisibility,
  RepeatFrequency,
  TriggerType,
} from '@notifee/react-native';
import { Platform } from 'react-native';
import { getJson, setJson } from '../storage/app.storage';
import {
  KAZI_NOTIFICATION_CHANNEL,
  ensureNotificationChannel,
} from './service';
import { buildDailyReminderContent } from './reminderContent';
import { lockScreenReminderContent } from './lockScreen';

export const REMINDER_STORAGE_KEY = 'kazi.dailyReminder';
export const REMINDER_NOTIFICATION_ID = 'kazi-daily-reminder';

export interface ReminderSettings {
  enabled: boolean;
  hour: number;
  minute: number;
}

export interface ReminderContent {
  title: string;
  body: string;
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  enabled: false,
  hour: 19,
  minute: 0,
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.trunc(value);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

export function normalizeReminderSettings(input: unknown): ReminderSettings {
  if (typeof input !== 'object' || input === null) {
    return { ...DEFAULT_REMINDER_SETTINGS };
  }
  const candidate = input as Partial<ReminderSettings>;
  return {
    enabled: candidate.enabled === true,
    hour: clampInt(candidate.hour, 0, 23, DEFAULT_REMINDER_SETTINGS.hour),
    minute: clampInt(candidate.minute, 0, 59, DEFAULT_REMINDER_SETTINGS.minute),
  };
}

export async function loadReminderSettings(): Promise<ReminderSettings> {
  const stored = await getJson<unknown>(REMINDER_STORAGE_KEY);
  return normalizeReminderSettings(stored);
}

export async function saveReminderSettings(settings: ReminderSettings): Promise<void> {
  await setJson(REMINDER_STORAGE_KEY, normalizeReminderSettings(settings));
}

export function nextReminderDate(
  hour: number,
  minute: number,
  from: Date = new Date(),
): Date {
  const next = new Date(from);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= from.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

export async function cancelDailyReminder(): Promise<void> {
  await notifee.cancelNotification(REMINDER_NOTIFICATION_ID);
}

export async function scheduleDailyReminder(
  settings: ReminderSettings,
  content: ReminderContent,
  platform: string = Platform.OS,
): Promise<void> {
  const normalized = normalizeReminderSettings(settings);
  await ensureNotificationChannel();
  const timestamp = nextReminderDate(normalized.hour, normalized.minute).getTime();
  const display = lockScreenReminderContent(platform) ?? content;
  await notifee.createTriggerNotification(
    {
      id: REMINDER_NOTIFICATION_ID,
      title: display.title,
      body: display.body,
      android: {
        channelId: KAZI_NOTIFICATION_CHANNEL,
        importance: AndroidImportance.HIGH,
        visibility: AndroidVisibility.SECRET,
        pressAction: { id: 'default' },
        // Show when the reminder was actually posted. `android.timestamp` is
        // deliberately left unset: it would freeze the schedule time and show
        // it as if it were the delivery time.
        showTimestamp: true,
      },
    },
    {
      type: TriggerType.TIMESTAMP,
      timestamp,
      repeatFrequency: RepeatFrequency.DAILY,
    },
  );
}

export async function applyDailyReminder(
  settings: ReminderSettings,
  content: ReminderContent,
  platform: string = Platform.OS,
): Promise<void> {
  const normalized = normalizeReminderSettings(settings);
  await saveReminderSettings(normalized);
  if (normalized.enabled) {
    await scheduleDailyReminder(normalized, content, platform);
  } else {
    await cancelDailyReminder();
  }
}

// Re-schedules an enabled reminder with freshly composed content. The OS
// repeats the notification it was given, so without this the figures would
// stay as old as the last time the user opened the Reminder screen.
export async function refreshDailyReminder(): Promise<void> {
  const settings = await loadReminderSettings();
  if (!settings.enabled) {
    return;
  }
  await applyDailyReminder(settings, await buildDailyReminderContent());
}
