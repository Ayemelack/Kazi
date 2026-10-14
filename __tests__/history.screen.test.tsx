import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import i18n from '../src/i18n';
import HistoryScreen from '../src/screens/history/HistoryScreen';
import { listActivity } from '../src/offline/api';
import { todayAsDateString } from '../src/transactions/validation';
import type { HistoryStackParamList } from '../src/navigation/RootNavigator';
import type { ActivityResponse, ActivityQuery } from '../src/activity/types';
import { ToastProvider } from '../src/components/ui/Toast';
import type { LocalActivity } from '../src/offline/types';
import ErrorState from '../src/components/ui/ErrorState';
import { lastOlderDay, olderRange } from '../src/activity/olderRange';
import en from '../src/i18n/locales/en';
import fr from '../src/i18n/locales/fr';
import wes from '../src/i18n/locales/wes';

jest.mock('../src/offline/api', () => ({
  listActivity: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => {
  const ReactModule = require('react');
  const zero = { top: 0, right: 0, bottom: 0, left: 0 };
  const Context = ReactModule.createContext(zero);
  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
    SafeAreaConsumer: ({ children }: { children: (insets: typeof zero) => React.ReactNode }) =>
      children(zero),
    SafeAreaInsetsContext: Context,
    useSafeAreaInsets: () => zero,
    initialWindowMetrics: {
      frame: { x: 0, y: 0, width: 0, height: 0 },
      insets: zero,
    },
  };
});

const Stack = createNativeStackNavigator<HistoryStackParamList>();

function shift(date: string, days: number): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const value = new Date(year, month - 1, day);
  value.setDate(value.getDate() + days);
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const TODAY = todayAsDateString();
const YESTERDAY = shift(TODAY, -1);

function event(id: number, type: LocalActivity['type'], eventDate: string, amount?: number): LocalActivity {
  return {
    id,
    type,
    amount,
    eventDate,
    createdAt: `${eventDate}T10:00:00.000Z`,
    syncStatus: 'synced',
  };
}

function response(overrides: Partial<ActivityResponse> = {}): ActivityResponse {
  return {
    events: [],
    summary: { received: 0, spent: 0, made: 0, capital: 0 },
    totalCount: 0,
    hasMore: false,
    ...overrides,
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderHistory(): Promise<ReactTestRenderer.ReactTestRenderer> {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <ToastProvider>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="HistoryList" component={HistoryScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </ToastProvider>,
    );
  });
  await flush();
  return renderer!;
}

function countText(
  renderer: ReactTestRenderer.ReactTestRenderer,
  value: string,
): number {
  return renderer.root
    .findAllByType(Text)
    .filter(node => typeof node.props.children === 'string' && node.props.children === value)
    .length;
}

describe('HistoryScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (listActivity as jest.Mock).mockResolvedValue(response());
  });

  it('filters with today as the device day and groups the day under one heading', async () => {
    (listActivity as jest.Mock).mockResolvedValue(
      response({
        events: [
          event(1, 'sale', TODAY, 2000),
          event(2, 'spend', TODAY, 500),
          event(3, 'sale', YESTERDAY, 300),
        ],
        summary: { received: 2300, spent: 500, made: 1800, capital: 0 },
        totalCount: 3,
        hasMore: false,
      }),
    );

    const renderer = await renderHistory();

    expect(listActivity).toHaveBeenCalledTimes(1);
    const query = (listActivity as jest.Mock).mock.calls[0][0] as ActivityQuery;
    expect(query).toMatchObject({ period: 'today', asOf: TODAY });

    for (const period of ['today', 'yesterday', 'this_week', 'older']) {
      expect(renderer.root.findByProps({ testID: `history-period-${period}` })).toBeTruthy();
    }

    // One "Yesterday" comes from the period chip, the second from the day
    // heading above the older event.
    expect(countText(renderer, 'Yesterday')).toBe(2);
    expect(countText(renderer, 'Today')).toBe(2);

    const text = renderer.root
      .findAllByType(Text)
      .map(node => [node.props.children].flat(Infinity).join(''))
      .join('|');
    expect(text).toContain('+2\u202f000\u202fFCFA');
    expect(text).toContain('−500\u202fFCFA');
    expect(text).toContain('+1\u202f800\u202fFCFA');
  });

  it('asks for the next page with the number of events already shown', async () => {
    const pageOne = response({
      events: [
        event(1, 'sale', TODAY, 2000),
        event(2, 'spend', TODAY, 500),
        event(3, 'sale', YESTERDAY, 300),
      ],
      totalCount: 4,
      hasMore: true,
    });
    (listActivity as jest.Mock)
      .mockResolvedValueOnce(pageOne)
      .mockResolvedValueOnce(response({ events: [event(4, 'capital', YESTERDAY, 1000)] }));

    const renderer = await renderHistory();

    await act(async () => {
      renderer.root.findByProps({ testID: 'history-load-more' }).props.onPress();
    });
    await flush();

    expect(listActivity).toHaveBeenCalledTimes(2);
    expect((listActivity as jest.Mock).mock.calls[1][0]).toMatchObject({ offset: 3 });
    expect(countText(renderer, 'Yesterday')).toBe(2);
  });

  it('shows an explicit empty state when nothing has happened yet', async () => {
    const renderer = await renderHistory();

    expect(countText(renderer, 'Nothing has happened yet.')).toBe(1);
    expect(renderer.root.findByProps({ testID: 'history-period-today' })).toBeTruthy();
  });
});

describe('HistoryScreen dates follow the app language (KZ-24)', () => {
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('re-formats an older day heading when the language changes', async () => {
    (listActivity as jest.Mock).mockResolvedValue(
      response({ events: [event(9, 'sale', '2025-03-04', 100)], totalCount: 1 }),
    );
    const renderer = await renderHistory();
    const text = () =>
      renderer.root
        .findAllByType(Text)
        .map(node => [node.props.children].flat(Infinity).join(''))
        .join('|');

    expect(text()).toContain('March 2025');

    await act(async () => {
      await i18n.changeLanguage('fr');
    });
    expect(text()).toContain('mars 2025');
    expect(text()).not.toContain('March 2025');

    await act(async () => {
      await i18n.changeLanguage('wes');
    });
    expect(text()).toContain('March 2025');
  });
});
// KZ-28: "Older" never reaches into this week, and an impossible range is a
// translated message under the From field, not an error screen.
describe('olderRange', () => {
  const today = '2026-10-14';
  const cases: Array<[string, string, string, ReturnType<typeof olderRange>]> = [
    ['no dates', '', '', { ok: true, startDate: undefined, endDate: '2026-10-07' }],
    ['From only', '2026-09-01', '', { ok: true, startDate: '2026-09-01', endDate: '2026-10-07' }],
    ['From on the last older day', '2026-10-07', '', { ok: true, startDate: '2026-10-07', endDate: '2026-10-07' }],
    ['To only, before this week', '', '2026-09-30', { ok: true, startDate: undefined, endDate: '2026-09-30' }],
    ['To only, inside this week', '', '2026-10-12', { ok: true, startDate: undefined, endDate: '2026-10-07' }],
    ['both, To inside this week', '2026-09-01', '2026-10-14', { ok: true, startDate: '2026-09-01', endDate: '2026-10-07' }],
    ['From after To', '2026-09-10', '2026-09-01', { ok: false, error: 'fromAfterTo', lastOlderDay: '2026-10-07' }],
    ['From inside this week', '2026-10-09', '', { ok: false, error: 'fromInThisWeek', lastOlderDay: '2026-10-07' }],
    ['From and To inside this week', '2026-10-09', '2026-10-10', { ok: false, error: 'fromInThisWeek', lastOlderDay: '2026-10-07' }],
  ];
  it.each(cases)('%s', (_label, from, to, expected) => {
    expect(olderRange(today, from, to)).toEqual(expected);
  });

  it('ends the day before the server\'s this_week window starts', () => {
    // The server's this_week is asOf − 6 … asOf.
    expect(lastOlderDay('2026-03-01')).toBe('2026-02-22');
  });
});

describe('HistoryScreen "Older" range (KZ-28)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (listActivity as jest.Mock).mockResolvedValue(response());
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  async function openOlder(renderer: ReactTestRenderer.ReactTestRenderer) {
    await act(async () => {
      renderer.root.findByProps({ testID: 'history-period-older' }).props.onPress();
    });
    await flush();
  }

  async function pick(renderer: ReactTestRenderer.ReactTestRenderer, testID: string, value: string) {
    const field = renderer.root.find(
      node => node.props.testID === testID && typeof node.props.onChange === 'function',
    );
    await act(async () => {
      field.props.onChange(value);
    });
    await flush();
  }

  function lastQuery(): ActivityQuery {
    const calls = (listActivity as jest.Mock).mock.calls;
    return calls[calls.length - 1][0] as ActivityQuery;
  }

  it('with only From, ends the day before this week starts', async () => {
    const renderer = await renderHistory();
    await openOlder(renderer);
    await pick(renderer, 'history-range-from', '2025-01-01');
    expect(lastQuery()).toMatchObject({
      period: undefined,
      startDate: '2025-01-01',
      endDate: shift(TODAY, -7),
    });
  });

  it('with only To, caps at that day, and never past the last older day', async () => {
    const renderer = await renderHistory();
    await openOlder(renderer);
    await pick(renderer, 'history-range-to', '2025-02-01');
    expect(lastQuery()).toMatchObject({ startDate: undefined, endDate: '2025-02-01' });
    await pick(renderer, 'history-range-to', TODAY);
    expect(lastQuery()).toMatchObject({ startDate: undefined, endDate: shift(TODAY, -7) });
  });

  it('shows From after To inline, translated, without a request or an error screen', async () => {
    const renderer = await renderHistory();
    await openOlder(renderer);
    await pick(renderer, 'history-range-to', '2025-02-01');
    const requests = (listActivity as jest.Mock).mock.calls.length;
    await pick(renderer, 'history-range-from', '2025-03-01');

    expect((listActivity as jest.Mock).mock.calls.length).toBe(requests);
    const from = renderer.root.find(
      node => node.props.testID === 'history-range-from' && typeof node.props.onChange === 'function',
    );
    expect(from.props.error).toBe(en.history.rangeFromAfterTo);
    expect(countText(renderer, en.history.rangeFromAfterTo)).toBe(1);
    expect(renderer.root.findAllByType(ErrorState)).toHaveLength(0);
    // The range fields stay on screen so the owner can fix it.
    expect(renderer.root.findByProps({ testID: 'history-clear-range' })).toBeTruthy();

    await act(async () => {
      await i18n.changeLanguage('fr');
    });
    expect(countText(renderer, fr.history.rangeFromAfterTo)).toBe(1);
    await act(async () => {
      await i18n.changeLanguage('wes');
    });
    expect(countText(renderer, wes.history.rangeFromAfterTo)).toBe(1);

    // Fixing it loads again.
    await pick(renderer, 'history-range-from', '2025-01-15');
    expect(lastQuery()).toMatchObject({ startDate: '2025-01-15', endDate: '2025-02-01' });
  });

  it('explains a From date inside this week', async () => {
    const renderer = await renderHistory();
    await openOlder(renderer);
    await pick(renderer, 'history-range-from', TODAY);
    const message = en.history.rangeFromThisWeek.replace('{{date}}', shift(TODAY, -7));
    expect(countText(renderer, message)).toBe(1);
  });
});
