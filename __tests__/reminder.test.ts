import notifee from '@notifee/react-native';
import {
  DEFAULT_REMINDER_SETTINGS,
  REMINDER_NOTIFICATION_ID,
  applyDailyReminder,
  loadReminderSettings,
  nextReminderDate,
  normalizeReminderSettings,
  refreshDailyReminder,
  saveReminderSettings,
} from '../src/notifications/reminder';

// Refreshing composes fresh content from the API; these tests only care about
// how that content is scheduled, so both requests stay offline.
jest.mock('../src/summary/api', () => ({
  fetchSummary: jest.fn(async () => {
    throw new Error('offline');
  }),
}));
jest.mock('../src/debts/api', () => ({
  listDebts: jest.fn(async () => {
    throw new Error('offline');
  }),
}));

const CONTENT = { title: 'Kazi reminder', body: 'Have you recorded?' };

describe('normalizeReminderSettings', () => {
  it('falls back to defaults for empty input', () => {
    expect(normalizeReminderSettings(null)).toEqual(DEFAULT_REMINDER_SETTINGS);
    expect(normalizeReminderSettings('nonsense')).toEqual(DEFAULT_REMINDER_SETTINGS);
  });

  it('clamps out-of-range hours and minutes', () => {
    expect(normalizeReminderSettings({ enabled: true, hour: 99, minute: -5 })).toEqual({
      enabled: true,
      hour: 23,
      minute: 0,
    });
    expect(normalizeReminderSettings({ enabled: false, hour: 12.9, minute: 45 })).toEqual({
      enabled: false,
      hour: 12,
      minute: 45,
    });
  });

  it('only treats a literal true as enabled', () => {
    expect(normalizeReminderSettings({ enabled: 'yes' }).enabled).toBe(false);
  });
});

describe('nextReminderDate', () => {
  it('schedules later today when the time is still ahead', () => {
    const from = new Date(2026, 0, 5, 8, 0, 0, 0);
    const next = nextReminderDate(19, 0, from);
    expect(next.getDate()).toBe(5);
    expect(next.getHours()).toBe(19);
    expect(next.getMinutes()).toBe(0);
  });

  it('rolls over to tomorrow when the time already passed', () => {
    const from = new Date(2026, 0, 5, 20, 0, 0, 0);
    const next = nextReminderDate(19, 0, from);
    expect(next.getDate()).toBe(6);
    expect(next.getHours()).toBe(19);
  });
});

describe('applyDailyReminder', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('schedules a repeating daily trigger and saves the settings', async () => {
    await applyDailyReminder({ enabled: true, hour: 18, minute: 30 }, CONTENT);

    expect(notifee.createTriggerNotification).toHaveBeenCalledTimes(1);
    const [notification, trigger] = (notifee.createTriggerNotification as jest.Mock).mock
      .calls[0];
    expect(notification.id).toBe(REMINDER_NOTIFICATION_ID);
    expect(notification.title).toBe(CONTENT.title);
    expect(notification.body).toBe(CONTENT.body);
    expect(trigger.repeatFrequency).toBe(1);

    await expect(loadReminderSettings()).resolves.toEqual({
      enabled: true,
      hour: 18,
      minute: 30,
    });
  });

  it('cancels the reminder when it is disabled', async () => {
    await applyDailyReminder({ enabled: false, hour: 18, minute: 30 }, CONTENT);

    expect(notifee.cancelNotification).toHaveBeenCalledWith(REMINDER_NOTIFICATION_ID);
    expect(notifee.createTriggerNotification).not.toHaveBeenCalled();
  });

  it('shows the genuine post time, never the scheduled trigger time', async () => {
    const before = Date.now();
    await applyDailyReminder({ enabled: true, hour: 18, minute: 30 }, CONTENT);

    const [notification, trigger] = (notifee.createTriggerNotification as jest.Mock).mock
      .calls[0];
    expect(notification.android.showTimestamp).toBe(true);
    expect(notification.android.timestamp).toBeUndefined();
    expect(trigger.timestamp).toBeGreaterThanOrEqual(before);
  });
});

describe('refreshDailyReminder', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await saveReminderSettings(DEFAULT_REMINDER_SETTINGS);
  });

  it('leaves a disabled reminder alone', async () => {
    await refreshDailyReminder();

    expect(notifee.createTriggerNotification).not.toHaveBeenCalled();
    expect(notifee.cancelNotification).not.toHaveBeenCalled();
  });

  it('reschedules an enabled reminder with freshly composed content', async () => {
    await saveReminderSettings({ enabled: true, hour: 8, minute: 15 });

    await refreshDailyReminder();

    expect(notifee.createTriggerNotification).toHaveBeenCalledTimes(1);
    const [notification] = (notifee.createTriggerNotification as jest.Mock).mock.calls[0];
    expect(notification.id).toBe(REMINDER_NOTIFICATION_ID);
    expect(notification.title).toBe('Kazi reminder');
    expect(notification.body).toContain("Have you recorded today's business transactions?");
  });
});
