import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import '../src/i18n';
import HistoryScreen from '../src/screens/history/HistoryScreen';
import { listActivity } from '../src/offline/api';
import { todayAsDateString } from '../src/transactions/validation';
import type { HistoryStackParamList } from '../src/navigation/RootNavigator';
import type { ActivityResponse, ActivityQuery } from '../src/activity/types';
import { ToastProvider } from '../src/components/ui/Toast';
import type { LocalActivity } from '../src/offline/types';

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

const mountedRenderers: ReactTestRenderer.ReactTestRenderer[] = [];

afterEach(() => {
  act(() => {
    for (const renderer of mountedRenderers.splice(0)) {
      renderer.unmount();
    }
  });
});

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
  mountedRenderers.push(renderer!);
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
    expect(text).toContain('+2 000 FCFA');
    expect(text).toContain('−500 FCFA');
    expect(text).toContain('+1 800 FCFA');
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
