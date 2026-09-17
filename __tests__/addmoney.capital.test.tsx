import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import '../src/i18n';
import AddMoneyScreen from '../src/screens/history/AddMoneyScreen';
import { createTransaction, fetchSummary } from '../src/offline/api';
import { ToastProvider } from '../src/components/ui/Toast';
import type { MoneySummary } from '../src/summary/api';

jest.mock('../src/offline/api', () => ({
  createTransaction: jest.fn(),
  fetchSummary: jest.fn(),
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

const Tab = createBottomTabNavigator<Record<string, object | undefined>>();
const navigationRef = createNavigationContainerRef<Record<string, object | undefined>>();

function AddMoneyRoute(props: object) {
  const { navigation, route } = props as { navigation: object; route: object };
  return <AddMoneyScreen navigation={navigation as never} route={route as never} />;
}

function Harness() {
  return (
    <ToastProvider>
      <NavigationContainer ref={navigationRef}>
        <Tab.Navigator initialRouteName="AddMoney" screenOptions={{ headerShown: false }}>
          <Tab.Screen name="AddMoney" component={AddMoneyRoute} />
        </Tab.Navigator>
      </NavigationContainer>
    </ToastProvider>
  );
}

function renderScreen() {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  act(() => {
    renderer = ReactTestRenderer.create(<Harness />);
  });
  return { renderer: renderer! };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const SUMMARY_CAPITAL: MoneySummary = {
  todayReceived: 0,
  todaySpent: 0,
  todayNet: 0,
  totalReceived: 0,
  totalSpent: 0,
  totalNet: 0,
  totalCapital: 11000000,
};

async function typeAmount(renderer: ReactTestRenderer.ReactTestRenderer, amount: string) {
  const input = renderer.root.findByProps({ testID: 'add-money-amount' });
  await act(async () => {
    input.props.onChangeText(amount);
  });
}

async function save(renderer: ReactTestRenderer.ReactTestRenderer) {
  const button = renderer.root.findByProps({ testID: 'add-money-save' });
  await act(async () => {
    button.props.onPress();
  });
  await flush();
}

describe('AddMoneyScreen capital persistence and display', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (createTransaction as jest.Mock).mockResolvedValue({ transaction: {}, queued: false });
    (fetchSummary as jest.Mock).mockResolvedValue({ summary: SUMMARY_CAPITAL });
  });

  it('displays the previously recorded capital when the screen is opened', async () => {
    const { renderer } = renderScreen();
    await flush();

    expect(fetchSummary).toHaveBeenCalledTimes(1);
    const texts = renderer.root
      .findAllByType(Text)
      .map(node =>
        Array.isArray(node.props.children)
          ? node.props.children.join('')
          : node.props.children,
      );
    expect(texts.some(text => typeof text === 'string' && text.includes('11 000 000 FCFA'))).toBe(true);
  });

  it('starts the amount field empty even when capital already exists', async () => {
    const { renderer } = renderScreen();
    await flush();

    const input = renderer.root.findByProps({ testID: 'add-money-amount' });
    expect(input.props.value).toBe('');
  });

  it('saves the entered amount as a capital transaction', async () => {
    const { renderer } = renderScreen();
    await flush();

    await typeAmount(renderer, '1000000');
    await save(renderer);

    expect(createTransaction).toHaveBeenCalledTimes(1);
    expect((createTransaction as jest.Mock).mock.calls[0][0]).toMatchObject({
      type: 'capital',
      amount: 1000000,
    });
  });

  it('creates a new capital deposit without mutating the previously recorded capital', async () => {
    const { renderer } = renderScreen();
    await flush();

    await typeAmount(renderer, '500000');
    await save(renderer);

    expect((createTransaction as jest.Mock).mock.calls[0][0]).toMatchObject({
      type: 'capital',
      amount: 500000,
    });

    // The recap still reflects only what was already recorded on the server.
    const input = renderer.root.findByProps({ testID: 'add-money-amount' });
    expect(input.props.value).toBe('500000');
    expect(fetchSummary).toHaveBeenCalledTimes(1);
  });
});