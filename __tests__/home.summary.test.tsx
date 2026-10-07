import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import '../src/i18n';
import HomeScreen from '../src/screens/home/HomeScreen';
import { fetchSummary, listItems } from '../src/offline/api';
import type { MoneySummary } from '../src/summary/api';

jest.mock('../src/offline/api', () => ({
  fetchSummary: jest.fn(),
  listItems: jest.fn(),
}));

jest.mock('../src/auth/AuthContext', () => ({
  useAuth: () => ({ user: { firstName: 'Awa' }, status: 'authenticated' }),
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

const Tab = createBottomTabNavigator();

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderHome(): Promise<ReactTestRenderer.ReactTestRenderer> {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <NavigationContainer>
        <Tab.Navigator screenOptions={{ headerShown: false }}>
          <Tab.Screen name="Home" component={HomeScreen} />
        </Tab.Navigator>
      </NavigationContainer>,
    );
  });
  await flush();
  return renderer!;
}

function screenText(renderer: ReactTestRenderer.ReactTestRenderer): string {
  return renderer.root
    .findAllByType(Text)
    .map(node => [node.props.children].flat(Infinity).join(''))
    .join('|');
}

describe('HomeScreen money summary', () => {
  const SUMMARY: MoneySummary = {
    todayReceived: 1000,
    todaySpent: 400,
    todayNet: 600,
    totalReceived: 9000,
    totalSpent: 4000,
    totalNet: 5000,
    totalCapital: 0,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (fetchSummary as jest.Mock).mockResolvedValue({ summary: SUMMARY });
    (listItems as jest.Mock).mockResolvedValue({ items: [] });
  });

  it('shows what was actually made today, not what came in', async () => {
    const renderer = await renderHome();
    const text = screenText(renderer);

    expect(text).toContain('+600 FCFA');
    // The received figure must only ever appear once, under "Money I
    // received". Showing it again under "Money I made" was the bug that made
    // every expense look like it never happened.
    expect(text.split('+1 000 FCFA')).toHaveLength(2);
    expect(fetchSummary).toHaveBeenCalledTimes(1);
  });

  it('does not prefix a loss with a plus sign', async () => {
    (fetchSummary as jest.Mock).mockResolvedValue({
      summary: { ...SUMMARY, todayReceived: 100, todaySpent: 500, todayNet: -400 },
    });

    const renderer = await renderHome();
    const text = screenText(renderer);

    expect(text).toContain('-400 FCFA');
    expect(text).not.toContain('+-400 FCFA');
    expect(text).toContain('−500 FCFA');
  });
});
