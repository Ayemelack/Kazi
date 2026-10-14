import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import i18n from '../src/i18n';
import en from '../src/i18n/locales/en';
import fr from '../src/i18n/locales/fr';
import { ApiError, NetworkError } from '../src/errors/ApiError';
import HomeScreen from '../src/screens/home/HomeScreen';
import { fetchSummary, listItems } from '../src/offline/api';
import type { MoneySummary } from '../src/summary/api';
import { todayAsDateString } from '../src/transactions/validation';

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
    lowStockCount: 0,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (fetchSummary as jest.Mock).mockResolvedValue({ summary: SUMMARY });
    (listItems as jest.Mock).mockResolvedValue({ items: [] });
  });

  it('shows what was actually made today, not what came in', async () => {
    const renderer = await renderHome();
    const text = screenText(renderer);

    expect(text).toContain('+600\u202fFCFA');
    // The received figure must only ever appear once, under "Money I
    // received". Showing it again under "Money I made" was the bug that made
    // every expense look like it never happened.
    expect(text.split('+1\u202f000\u202fFCFA')).toHaveLength(2);
    expect(fetchSummary).toHaveBeenCalledTimes(1);
  });

  it('does not prefix a loss with a plus sign', async () => {
    (fetchSummary as jest.Mock).mockResolvedValue({
      summary: { ...SUMMARY, todayReceived: 100, todaySpent: 500, todayNet: -400 },
    });

    const renderer = await renderHome();
    const text = screenText(renderer);

    expect(text).toContain('-400\u202fFCFA');
    expect(text).not.toContain('+-400\u202fFCFA');
    expect(text).toContain('−500\u202fFCFA');
  });

  // KZ-10: "today" is the phone's day, and Home needs one request.
  it('asks for the phone\'s today and never loads the item list', async () => {
    await renderHome();
    expect(fetchSummary).toHaveBeenCalledTimes(1);
    expect(fetchSummary).toHaveBeenCalledWith(todayAsDateString());
    expect(listItems).not.toHaveBeenCalled();
  });

  it('shows the low-stock alert from the summary\'s lowStockCount', async () => {
    (fetchSummary as jest.Mock).mockResolvedValue({ summary: { ...SUMMARY, lowStockCount: 3 } });
    const renderer = await renderHome();
    expect(screenText(renderer)).toContain('3 items are low on stock.');

    (fetchSummary as jest.Mock).mockResolvedValue({ summary: { ...SUMMARY, lowStockCount: 0 } });
    const quiet = await renderHome();
    expect(screenText(quiet)).not.toContain(en.home.lowStockTitle);
  });

  it('counts money added as activity, so a capital-only notebook gets no first-use hint', async () => {
    const empty = { ...SUMMARY, todayReceived: 0, todaySpent: 0, todayNet: 0, totalReceived: 0, totalSpent: 0, totalNet: 0 };
    (fetchSummary as jest.Mock).mockResolvedValue({ summary: empty });
    expect(screenText(await renderHome())).toContain(en.home.firstHint);

    (fetchSummary as jest.Mock).mockResolvedValue({ summary: { ...empty, totalCapital: 50000 } });
    expect(screenText(await renderHome())).not.toContain(en.home.firstHint);
  });
});

describe('HomeScreen load errors', () => {
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('says the server is unreachable (not offline) and re-translates on a language switch', async () => {
    (fetchSummary as jest.Mock).mockRejectedValue(
      new ApiError(0, 'The server could not be reached.', 'SERVER_UNREACHABLE'),
    );
    (listItems as jest.Mock).mockResolvedValue({ items: [] });

    const renderer = await renderHome();
    expect(screenText(renderer)).toContain(en.errors.serverUnreachable);
    expect(screenText(renderer)).not.toContain(en.errors.offline);

    await act(async () => {
      await i18n.changeLanguage('fr');
    });
    expect(screenText(renderer)).toContain(fr.errors.serverUnreachable);
    expect(screenText(renderer)).not.toContain(en.errors.serverUnreachable);
  });

  it('says offline only for a NetworkError', async () => {
    (fetchSummary as jest.Mock).mockRejectedValue(new NetworkError());
    (listItems as jest.Mock).mockResolvedValue({ items: [] });

    const renderer = await renderHome();
    expect(screenText(renderer)).toContain(en.errors.offline);
  });
});