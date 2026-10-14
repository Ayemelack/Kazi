// KZ-11: every write form sends one clientOpId per submission. A retry of the
// same submission (after a timeout or a lost response) reuses it, so the API
// replays the first answer instead of recording the write twice; an edit or a
// success starts a new one.
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import '../src/i18n';
import { CLIENT_OP_ID_MIN } from '@kazi/shared';
import { ToastProvider } from '../src/components/ui/Toast';
import { ApiError } from '../src/errors/ApiError';
import { useSubmission, type Submission } from '../src/forms/useSubmission';
import TransactionFormScreen from '../src/screens/history/TransactionFormScreen';
import AddMoneyScreen from '../src/screens/history/AddMoneyScreen';
import DebtFormScreen from '../src/screens/debts/DebtFormScreen';
import DebtsScreen from '../src/screens/debts/DebtsScreen';
import ProductFormScreen from '../src/screens/products/ProductFormScreen';
import StockMovementDialog from '../src/screens/products/StockMovementDialog';
import ConfirmDialog from '../src/components/ui/ConfirmDialog';
import {
  createDebt,
  createItem,
  createTransaction,
  getItem,
  listDebts,
  payDebt,
  stockIn,
  stockOut,
} from '../src/offline/api';
import type { Item } from '../src/items/types';
import type { Debt } from '../src/debts/types';

jest.mock('../src/offline/api', () => ({
  createTransaction: jest.fn(),
  deleteTransaction: jest.fn(),
  fetchSummary: jest.fn(async () => ({ summary: { totalCapital: 0 } })),
  listItems: jest.fn(async () => ({ items: [] })),
  createDebt: jest.fn(),
  listDebts: jest.fn(),
  payDebt: jest.fn(),
  deleteDebt: jest.fn(),
  getItem: jest.fn(),
  createItem: jest.fn(),
  updateItem: jest.fn(),
  deleteItem: jest.fn(),
  stockIn: jest.fn(),
  stockOut: jest.fn(),
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

type Renderer = ReactTestRenderer.ReactTestRenderer;

const Tab = createBottomTabNavigator<Record<string, object | undefined>>();

function Blank() {
  return <Text>Blank</Text>;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

type FormScreen = React.ComponentType<{ navigation: unknown; route: unknown }>;

async function renderForm(Screen: FormScreen, params?: object): Promise<Renderer> {
  function Route(props: object) {
    const { navigation, route } = props as { navigation: object; route: object };
    return <Screen navigation={navigation} route={route} />;
  }
  let renderer: Renderer | undefined;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <ToastProvider>
        <NavigationContainer>
          <Tab.Navigator initialRouteName="Form" screenOptions={{ headerShown: false }}>
            <Tab.Screen name="Blank" component={Blank} />
            <Tab.Screen name="Form" component={Route} initialParams={params} />
          </Tab.Navigator>
        </NavigationContainer>
      </ToastProvider>,
    );
  });
  await flush();
  return renderer!;
}

async function type(renderer: Renderer, testID: string, value: string) {
  const input = renderer.root.find(
    node => node.props.testID === testID && typeof node.props.onChangeText === 'function',
  );
  await act(async () => {
    input.props.onChangeText(value);
  });
}

async function press(renderer: Renderer, testID: string) {
  const button = renderer.root.find(
    node => node.props.testID === testID && node.props.accessibilityState !== undefined,
  );
  await act(async () => {
    button.props.onPress();
  });
  await flush();
}

// The response never arrived: the write may or may not have happened.
const lost = () => new ApiError(0, 'The server did not answer in time.', 'SERVER_UNREACHABLE');

function sentIds(mock: unknown, argIndex = 0, key = 'clientOpId'): string[] {
  return (mock as jest.Mock).mock.calls.map(call => {
    const arg = call[argIndex] as Record<string, unknown> | string;
    return typeof arg === 'string' ? arg : (arg[key] as string);
  });
}

function expectValidId(id: string) {
  expect(typeof id).toBe('string');
  expect(id.length).toBeGreaterThanOrEqual(Math.max(20, CLIENT_OP_ID_MIN));
}

describe('useSubmission', () => {
  function capture(): { current: Submission } {
    const ref = { current: undefined as unknown as Submission };
    function Probe() {
      ref.current = useSubmission();
      return null;
    }
    act(() => {
      ReactTestRenderer.create(<Probe />);
    });
    return ref;
  }

  it('keeps one id for the same values until the write succeeds', () => {
    const submission = capture().current;
    const first = submission.opId({ amount: 1000, date: '2026-10-14' });
    expectValidId(first);
    expect(submission.opId({ amount: 1000, date: '2026-10-14' })).toBe(first);
    submission.succeeded();
    expect(submission.opId({ amount: 1000, date: '2026-10-14' })).not.toBe(first);
  });

  it('makes a new id when any value changes', () => {
    const submission = capture().current;
    const first = submission.opId({ amount: 1000, note: undefined });
    const edited = submission.opId({ amount: 1000, note: 'rice' });
    expect(edited).not.toBe(first);
    expect(submission.opId({ amount: 1000, note: 'rice' })).toBe(edited);
  });
});

describe('forms send one clientOpId per submission', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('TransactionForm: retry reuses the id, an edit replaces it', async () => {
    (createTransaction as jest.Mock)
      .mockRejectedValueOnce(lost())
      .mockRejectedValueOnce(lost())
      .mockRejectedValueOnce(lost())
      .mockResolvedValue({ transaction: {} });
    const renderer = await renderForm(TransactionFormScreen as never, { initialType: 'sale' });

    await type(renderer, 'transaction-amount', '2 500');
    await press(renderer, 'transaction-save');
    await press(renderer, 'transaction-save');
    await type(renderer, 'transaction-amount', '3 000');
    await press(renderer, 'transaction-save');
    await press(renderer, 'transaction-save');

    const ids = sentIds(createTransaction);
    expect(ids).toHaveLength(4);
    ids.forEach(expectValidId);
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).not.toBe(ids[0]);
    expect(ids[3]).toBe(ids[2]);
    expect((createTransaction as jest.Mock).mock.calls[0][0]).toMatchObject({
      type: 'sale',
      amount: 2500,
    });
    expect((createTransaction as jest.Mock).mock.calls[3][0]).toMatchObject({ amount: 3000 });
  });

  it('AddMoney: retry reuses the id', async () => {
    (createTransaction as jest.Mock)
      .mockRejectedValueOnce(lost())
      .mockResolvedValue({ transaction: {} });
    const renderer = await renderForm(AddMoneyScreen as never);

    await type(renderer, 'add-money-amount', '50000');
    await press(renderer, 'add-money-save');
    await press(renderer, 'add-money-save');

    const ids = sentIds(createTransaction);
    expect(ids).toHaveLength(2);
    expectValidId(ids[0]);
    expect(ids[1]).toBe(ids[0]);
    expect((createTransaction as jest.Mock).mock.calls[0][0]).toMatchObject({ type: 'capital' });
  });

  it('DebtForm: retry reuses the id, an edit replaces it', async () => {
    (createDebt as jest.Mock).mockRejectedValue(lost());
    const renderer = await renderForm(DebtFormScreen as never);

    await type(renderer, 'debt-name', 'Mama Rose');
    await type(renderer, 'debt-amount', '15000');
    await press(renderer, 'debt-submit');
    await press(renderer, 'debt-submit');
    await type(renderer, 'debt-name', 'Mama Rosine');
    await press(renderer, 'debt-submit');

    const ids = sentIds(createDebt);
    expect(ids).toHaveLength(3);
    expectValidId(ids[0]);
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  it('ProductForm: creating an item retries with the same id', async () => {
    (createItem as jest.Mock).mockRejectedValueOnce(lost()).mockResolvedValue({ item: {} });
    const renderer = await renderForm(ProductFormScreen as never);

    await type(renderer, 'item-name', 'Bottled water');
    await type(renderer, 'item-price', '500');
    await press(renderer, 'item-save');
    await press(renderer, 'item-save');

    const ids = sentIds(createItem);
    expect(ids).toHaveLength(2);
    expectValidId(ids[0]);
    expect(ids[1]).toBe(ids[0]);
  });

  it('ProductForm: stock in and out retry with the same id, a new quantity gets a new one', async () => {
    const item: Item = {
      id: 7,
      name: 'Rice',
      type: 'product',
      price: 1000,
      stock: 10,
      trackStock: true,
      lowStock: false,
      lowStockThreshold: 2,
      createdAt: '2026-10-01T00:00:00.000Z',
    };
    (getItem as jest.Mock).mockResolvedValue({ item });
    (stockIn as jest.Mock).mockRejectedValueOnce(lost()).mockResolvedValue({ item });
    (stockOut as jest.Mock).mockRejectedValue(lost());
    const renderer = await renderForm(ProductFormScreen as never, { itemId: 7 });
    const confirm = async (quantity: number, reason?: string) => {
      await act(async () => {
        renderer.root.findByType(StockMovementDialog).props.onConfirm(quantity, reason);
      });
      await flush();
    };
    await press(renderer, 'item-stock-in');
    await confirm(5, 'Delivery');
    await confirm(5, 'Delivery');
    await press(renderer, 'item-stock-out');
    await confirm(2);
    await confirm(2);
    await confirm(3);

    const inIds = sentIds(stockIn, 1);
    expect(inIds).toHaveLength(2);
    expectValidId(inIds[0]);
    expect(inIds[1]).toBe(inIds[0]);
    const outIds = sentIds(stockOut, 1);
    expect(outIds).toHaveLength(3);
    expect(outIds[1]).toBe(outIds[0]);
    expect(outIds[2]).not.toBe(outIds[0]);
    expect(outIds[0]).not.toBe(inIds[0]);
  });

  it('Debts: paying again after a lost answer reuses the id', async () => {
    const debt: Debt = {
      id: 3,
      name: 'Claire',
      amount: 8000,
      date: '2026-10-01',
      status: 'open',
      createdAt: '2026-10-01T09:00:00.000Z',
    };
    (listDebts as jest.Mock).mockResolvedValue({ debts: [debt] });
    (payDebt as jest.Mock)
      .mockRejectedValueOnce(lost())
      .mockResolvedValue({ debt: { ...debt, status: 'paid' } });
    const renderer = await renderForm(DebtsScreen as never);

    const payOnce = async () => {
      await act(async () => {
        renderer.root
          .find(node => node.props.accessibilityLabel === 'Mark as paid' && typeof node.props.onPress === 'function')
          .props.onPress();
      });
      await flush();
      const dialog = renderer.root
        .findAllByType(ConfirmDialog)
        .find(node => node.props.visible === true);
      await act(async () => {
        dialog!.props.onConfirm();
      });
      await flush();
    };
    await payOnce();
    await payOnce();

    const ids = sentIds(payDebt, 2);
    expect(ids).toHaveLength(2);
    expectValidId(ids[0]);
    expect(ids[1]).toBe(ids[0]);
    expect((payDebt as jest.Mock).mock.calls[0][0]).toBe(3);
  });
});
