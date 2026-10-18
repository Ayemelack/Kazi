// The daily reminder repeats with the content frozen when it was scheduled, so
// the figures it carries must say which day they are from, and a failed
// request must fall back to the plain nudge instead of inventing numbers.

import { formatMoney } from '@kazi/shared';
import i18n, { formattingLocale } from '../src/i18n';
import { buildDailyReminderContent } from '../src/notifications/reminderContent';
import { fetchSummary } from '../src/summary/api';
import { listDebts } from '../src/debts/api';
import type { Debt, DebtStatus } from '../src/debts/types';

jest.mock('../src/summary/api', () => ({ fetchSummary: jest.fn() }));
jest.mock('../src/debts/api', () => ({ listDebts: jest.fn() }));

const NOW = new Date(2026, 0, 18, 9, 0, 0);

function summary(todayReceived: number, todaySpent: number) {
  return {
    summary: {
      todayReceived,
      todaySpent,
      todayNet: todayReceived - todaySpent,
      totalReceived: todayReceived,
      totalSpent: todaySpent,
      totalNet: todayReceived - todaySpent,
      totalCapital: todayReceived,
      lowStockCount: 0,
    },
  };
}

function debt(amount: number, status: DebtStatus): Debt {
  return {
    id: amount,
    name: 'Ada',
    amount,
    date: '2026-01-02',
    status,
    createdAt: '2026-01-02T08:00:00.000Z',
  };
}

describe('buildDailyReminderContent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchSummary as jest.Mock).mockRejectedValue(new Error('offline'));
    (listDebts as jest.Mock).mockRejectedValue(new Error('offline'));
  });

  it('falls back to the plain nudge when the API does not answer', async () => {
    const content = await buildDailyReminderContent(i18n.t, NOW);

    expect(content).toEqual({
      title: i18n.t('reminder.notificationTitle'),
      body: i18n.t('reminder.notificationBody'),
    });
  });

  it('adds the day figures under a label naming the day they were captured', async () => {
    (fetchSummary as jest.Mock).mockResolvedValue(summary(12500, 4000));
    (listDebts as jest.Mock).mockResolvedValue({ debts: [] });

    const content = await buildDailyReminderContent(i18n.t, NOW);
    const lines = content.body.split('\n');
    const dayLabel = new Date(2026, 0, 18).toLocaleDateString(formattingLocale(), {
      day: 'numeric',
      month: 'short',
    });

    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(i18n.t('reminder.notificationBody'));
    expect(lines[1]).toContain(dayLabel);
    expect(lines[1]).toContain(formatMoney(12500));
    expect(lines[1]).toContain(formatMoney(4000));
  });

  it('adds the total still owed, counting open debts only', async () => {
    (fetchSummary as jest.Mock).mockResolvedValue(summary(12500, 4000));
    (listDebts as jest.Mock).mockResolvedValue({
      debts: [debt(3000, 'open'), debt(2000, 'open'), debt(9999, 'paid')],
    });

    const content = await buildDailyReminderContent(i18n.t, NOW);
    const lines = content.body.split('\n');

    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain(formatMoney(5000));
    expect(lines[2]).not.toContain(formatMoney(9999));
  });

  it('stays quiet about debts when every debt is paid', async () => {
    (fetchSummary as jest.Mock).mockResolvedValue(summary(12500, 4000));
    (listDebts as jest.Mock).mockResolvedValue({ debts: [debt(9999, 'paid')] });

    const content = await buildDailyReminderContent(i18n.t, NOW);

    expect(content.body.split('\n')).toHaveLength(2);
  });

  it('keeps the debt line when only the summary request fails', async () => {
    (listDebts as jest.Mock).mockResolvedValue({ debts: [debt(3000, 'open')] });

    const content = await buildDailyReminderContent(i18n.t, NOW);
    const lines = content.body.split('\n');

    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(formatMoney(3000));
  });
});
