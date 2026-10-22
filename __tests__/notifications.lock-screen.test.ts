// The lock screen must not reveal stock, debt or money detail. Android masks
// it with visibility SECRET; iOS has no such switch, so the OS-visible text
// stays generic and the detail lives in the in-app notification history.

import notifee, { AndroidVisibility } from '@notifee/react-native';
import { formatMoney } from '@kazi/shared';
import i18n from '../src/i18n';
import {
  lockScreenPushContent,
  lockScreenReminderContent,
} from '../src/notifications/lockScreen';
import {
  REMINDER_NOTIFICATION_ID,
  scheduleDailyReminder,
} from '../src/notifications/reminder';
import { ensureNotificationChannel } from '../src/notifications/service';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('lock-screen content', () => {
  it('makes the push text generic on iOS and leaves Android untouched', () => {
    expect(lockScreenPushContent('android')).toBeNull();
    expect(lockScreenPushContent('ios')).toEqual({
      title: i18n.t('notifications.privateTitle'),
      body: i18n.t('notifications.privateBody'),
    });
  });

  it('posts the plain nudge, not the figures, on the iOS lock screen', () => {
    expect(lockScreenReminderContent('android')).toBeNull();
    expect(lockScreenReminderContent('ios')).toEqual({
      title: i18n.t('reminder.notificationTitle'),
      body: i18n.t('reminder.notificationBody'),
    });
  });

  it('hides the Android channel on the lock screen by default', async () => {
    await ensureNotificationChannel();

    expect(notifee.createChannel).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: AndroidVisibility.SECRET }),
    );
  });

  it('schedules the reminder with no money figures in the OS text', async () => {
    const received = formatMoney(12500);
    const spent = formatMoney(4000);
    const content = {
      title: i18n.t('reminder.notificationTitle'),
      body: [
        i18n.t('reminder.notificationBody'),
        i18n.t('reminder.notificationSummary', { date: '18 Jan', received, spent }),
      ].join('\n'),
    };

    await scheduleDailyReminder({ enabled: true, hour: 19, minute: 0 }, content, 'ios');

    const posted = (notifee.createTriggerNotification as jest.Mock).mock.calls[0][0];
    expect(posted.id).toBe(REMINDER_NOTIFICATION_ID);
    expect(posted.android.visibility).toBe(AndroidVisibility.SECRET);
    expect(posted.body).toBe(i18n.t('reminder.notificationBody'));
    expect(posted.body).not.toContain(received);
    expect(posted.body).not.toContain(spent);
  });
});
