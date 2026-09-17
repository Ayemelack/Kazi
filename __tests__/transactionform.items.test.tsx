import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import '../src/i18n';
import TransactionFormScreen from '../src/screens/history/TransactionFormScreen';
import { listItems, createTransaction } from '../src/offline/api';
import { ToastProvider } from '../src/components/ui/Toast';
import type { Item } from '../src/items/types';

jest.mock('../src/offline/api', () => ({
  listItems: jest.fn(),
  createTransaction: jest.fn(),
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

function HomeScreen() {
  return <Text>Home</Text>;
}

function TransactionFormRoute(props: object) {
  const { navigation, route } = props as {
    navigation: object;
    route: { params?: { initialType?: 'sale' | 'purchase' } };
  };
  return (
    <TransactionFormScreen
      navigation={navigation as never}
      route={route as never}
    />
  );
}

function Harness({ initialType = 'sale' }: { initialType?: 'sale' | 'purchase' }) {
  return (
    <ToastProvider>
      <NavigationContainer ref={navigationRef}>
        <Tab.Navigator initialRouteName="Form" screenOptions={{ headerShown: false }}>
          <Tab.Screen
            name="Form"
            component={TransactionFormRoute}
            initialParams={{ initialType }}
          />
          <Tab.Screen name="Home" component={HomeScreen} />
        </Tab.Navigator>
      </NavigationContainer>
    </ToastProvider>
  );
}

const MOCK_PRODUCT: Item = {
  id: 1,
  name: 'Mock Product',
  type: 'product',
  price: 100,
  stock: 5,
  trackStock: true,
  lowStock: false,
  lowStockThreshold: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
};

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function typeAmount(renderer: ReactTestRenderer.ReactTestRenderer, amount: string) {
  const input = renderer.root.findByProps({ testID: 'transaction-amount' });
  await act(async () => {
    input.props.onChangeText(amount);
  });
}

async function save(renderer: ReactTestRenderer.ReactTestRenderer) {
  const button = renderer.root.findByProps({ testID: 'transaction-save' });
  await act(async () => {
    button.props.onPress();
  });
  await flush();
}

describe('TransactionFormScreen item loading', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (listItems as jest.Mock).mockResolvedValue({ items: [] });
    (createTransaction as jest.Mock).mockResolvedValue({ transaction: {}, queued: false });
  });

  it('reloads the product list when the screen regains focus', async () => {
    (listItems as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [MOCK_PRODUCT] });

    const nav = navigationRef as unknown as { navigate: (name: string) => void };

    await act(async () => {
      ReactTestRenderer.create(<Harness />);
    });
    await flush();

    expect(listItems).toHaveBeenCalledTimes(1);

    await act(async () => {
      nav.navigate('Home');
    });
    await flush();

    await act(async () => {
      nav.navigate('Form');
    });
    await flush();

    expect(listItems).toHaveBeenCalledTimes(2);
  });
});

describe('TransactionFormScreen transaction classification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (listItems as jest.Mock).mockResolvedValue({ items: [] });
    (createTransaction as jest.Mock).mockResolvedValue({ transaction: {}, queued: false });
  });

  function render(initialType: 'sale' | 'purchase'): ReactTestRenderer.ReactTestRenderer {
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    act(() => {
      renderer = ReactTestRenderer.create(<Harness initialType={initialType} />);
    });
    return renderer!;
  }

  it('saves the transaction under the type shown by the form', async () => {
    const renderer = render('purchase');
    await flush();

    await typeAmount(renderer, '10000');
    await save(renderer);

    expect(createTransaction).toHaveBeenCalledTimes(1);
    expect((createTransaction as jest.Mock).mock.calls[0][0]).toMatchObject({
      type: 'purchase',
      amount: 10000,
    });
  });

  it('records the sale with the correct type after a Record a sale navigation on a reused screen', async () => {
    const renderer = render('purchase');
    await flush();

    const nav = navigationRef as unknown as { navigate: (name: string, params?: object) => void };

    // The "Record expense" flow opens the form first; the user switches tabs and
    // comes back through "Record a sale". The screen instance is reused, so it
    // must follow the new type AND start from a fresh, empty form.
    await act(async () => {
      nav.navigate('Home', {});
    });
    await flush();

    await act(async () => {
      nav.navigate('Form', { initialType: 'sale' });
    });
    await flush();

    await typeAmount(renderer, '10000');
    await save(renderer);

    expect(createTransaction).toHaveBeenCalledTimes(1);
    expect((createTransaction as jest.Mock).mock.calls[0][0]).toMatchObject({
      type: 'sale',
      amount: 10000,
    });
  });

  it('does not carry the sale amount into the expense form on the reused screen', async () => {
    const renderer = render('sale');
    await flush();

    await typeAmount(renderer, '20000');

    const nav = navigationRef as unknown as { navigate: (name: string, params?: object) => void };

    // Open "Record sale" and type an amount, then switch tabs and open
    // "Record expense". The same mounted screen is reused, so the expense form
    // must NOT inherit the 20 000 entered for the sale.
    await act(async () => {
      nav.navigate('Home', {});
    });
    await flush();

    await act(async () => {
      nav.navigate('Form', { initialType: 'purchase' });
    });
    await flush();

    const input = renderer.root.findByProps({ testID: 'transaction-amount' });
    expect(input.props.value).toBe('');
  });

  it('does not carry the expense amount into the sale form on the reused screen', async () => {
    const renderer = render('purchase');
    await flush();

    await typeAmount(renderer, '10000');

    const nav = navigationRef as unknown as { navigate: (name: string, params?: object) => void };

    // Open "Record expense" and type an amount, then switch tabs and open
    // "Record sale". The sale form must NOT inherit the 10 000 expense value.
    await act(async () => {
      nav.navigate('Home', {});
    });
    await flush();

    await act(async () => {
      nav.navigate('Form', { initialType: 'sale' });
    });
    await flush();

    const input = renderer.root.findByProps({ testID: 'transaction-amount' });
    expect(input.props.value).toBe('');
  });
});