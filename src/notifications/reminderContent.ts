import type { TFunction } from 'i18next';
import { formatMoney } from '@kazi/shared';
import i18n, { formattingLocale } from '../i18n';
import { listDebts } from '../debts/api';
import { fetchSummary } from '../summary/api';
import { dateToDateString } from '../transactions/validation';
import type { ReminderContent } from './reminder';

// The daily reminder repeats with the content frozen at the moment it was
// scheduled (the OS repeats the same notification), so the figures it shows
// must say which day they are from: a two-day-old reminder must never read as
// today's numbers. Nothing here invents a value: when the API does not answer,
// the reminder stays the plain nudge it always was.

function captureDayLabel(day: string, locale: string): string {
  const [year, month, date] = day.split('-').map(Number);
  if (!year || !month || !date) {
    return day;
  }
  return new Date(year, month - 1, date).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
  });
}

export async function buildDailyReminderContent(
  t: TFunction = i18n.t,
  now: Date = new Date(),
): Promise<ReminderContent> {
  const day = dateToDateString(now);
  const title = t('reminder.notificationTitle');
  const body = t('reminder.notificationBody');

  const [summaryResult, debtsResult] = await Promise.allSettled([
    fetchSummary(day),
    listDebts(),
  ]);

  const lines: string[] = [];

  if (summaryResult.status === 'fulfilled') {
    lines.push(
      t('reminder.notificationSummary', {
        date: captureDayLabel(day, formattingLocale()),
        received: formatMoney(summaryResult.value.summary.todayReceived),
        spent: formatMoney(summaryResult.value.summary.todaySpent),
      }),
    );
  }

  if (debtsResult.status === 'fulfilled') {
    const open = debtsResult.value.debts.filter(debt => debt.status === 'open');
    if (open.length > 0) {
      const outstanding = open.reduce((total, debt) => total + debt.amount, 0);
      lines.push(t('reminder.notificationDebts', { amount: formatMoney(outstanding) }));
    }
  }

  return { title, body: [body, ...lines].join('\n') };
}
