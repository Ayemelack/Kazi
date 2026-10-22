import { Platform } from 'react-native';
import i18n from '../i18n';

/**
 * Android hides a posted notification's contents on the lock screen when the
 * notification is given `visibility: AndroidVisibility.SECRET`. iOS has no
 * per-app equivalent: whatever the app hands the system is shown on the lock
 * screen, so the OS-visible text stays generic there. The detail is not lost:
 * the notification history carries it inside the app, and a tap still opens
 * the record the push is about.
 *
 * Both helpers return null outside iOS so callers keep their detailed text.
 * The platform is a parameter so both branches are testable.
 */
export function lockScreenPushContent(
  platform: string = Platform.OS,
): { title: string; body: string } | null {
  if (platform !== 'ios') {
    return null;
  }
  return {
    title: i18n.t('notifications.privateTitle'),
    body: i18n.t('notifications.privateBody'),
  };
}

/** The plain daily nudge, without the day's money figures. */
export function lockScreenReminderContent(
  platform: string = Platform.OS,
): { title: string; body: string } | null {
  if (platform !== 'ios') {
    return null;
  }
  return {
    title: i18n.t('reminder.notificationTitle'),
    body: i18n.t('reminder.notificationBody'),
  };
}
