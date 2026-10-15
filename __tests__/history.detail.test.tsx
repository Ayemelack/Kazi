// KZ-07: History rows open the record behind them. A sale, expense or money
// added opens a detail sheet with Delete (confirmed, translated) and Correct
// (a prefilled form that deletes the old record only after the new one is
// saved). Debt rows open the debt in the Debts list; product rows open nothing.
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import i18n from '../src/i18n';
import en from '../src/i18n/locales/en';
import fr from '../src/i18n/locales/fr';
import wes from '../src/i18n/locales/wes';
import HistoryScreen from '../src/screens/history/HistoryScreen';
import TransactionFormScreen from '../src/screens/history/TransactionFormScreen';
import AddMoneyScreen from '../src/screens/history/AddMoneyScreen';
import ConfirmDialog from '../src/components/ui/ConfirmDialog';
import { ToastProvider } from '../src/components/ui/Toast';
import { ApiError } from '../src/errors/ApiError';
import {
  createTransaction,
  deleteTransaction,
  getTransaction,
  listActivity,
  listItems,
} from '../src/offline/api';
import type { HistoryStackParamList } from '../src/navigation/RootNavigator';
import type { ActivityResponse } from '../src/activity/types';
import type { LocalActivity } from '../src/offline/types';
import type { Transaction } from '../src/transactions/types';
import type { Item } from '../src/items/types';

jest.mock('../src/offline/api', () => ({
  listActivity: jest.fn(),
  getTransaction: jest.fn(),
  deleteTransaction: jest.fn(),
  createTransaction: jest.fn(),
  listItems: jest.fn(),
  fetchSummary: jest.fn(async () => ({ summary: { totalCapital: 0 } })),
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

const Stack = createNativeStackNavigator<HistoryStackParamList>();

let debtsParams: unknown = null;
function DebtsProbe({ route }: { route: { params?: unknown } }) {
  debtsParams = route.params;
  return <Text>Debts list</Text>;
}

const DAY = '2026-10-14';

function event(overrides: Partial<LocalActivity> & Pick<LocalActivity, 'id' | 'type'>): LocalActivity {
  return {
    eventDate: DAY,
    createdAt: `${DAY}T10:00:00.000Z`,
    syncStatus: 'synced',
    ...overrides,
  };
}

const SALE_ROW = event({ id: 1, type: 'sale', amount: 4500, title: 'Palm oil', quantity: 3, refType: 'transaction', refId: 41 });
const CAPITAL_ROW = event({ id: 2, type: 'capital', amount: 20000, refType: 'transaction', refId: 42 });
const DEBT_ROW = event({ id: 3, type: 'debt_added', amount: 3000, title: 'Ma Ngono', refType: 'debt', refId: 7 });
const PRODUCT_ROW = event({ id: 4, type: 'product_added', title: 'Palm oil', refType: 'item', refId: 5 });

const OIL: Item = {
  id: 5,
  name: 'Palm oil',
  type: 'product',
  price: 1500,
  stock: 7,
  trackStock: true,
  lowStock: false,
  lowStockThreshold: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
};

const SALE: Transaction = {
  id: 41,
  type: 'sale',
  amount: 4500,
  description: 'Market day',
  item: { id: 5, name: 'Palm oil', type: 'product' },
  quantity: 3,
  date: DAY,
  createdAt: `${DAY}T10:00:00.000Z`,
};

const CAPITAL: Transaction = {
  id: 42,
  type: 'capital',
  amount: 20000,
  description: 'Savings',
  date: '2026-10-12',
  createdAt: '2026-10-12T08:00:00.000Z',
};

function response(events: LocalActivity[], received = 0): ActivityResponse {
  return {
    events,
    summary: { received, spent: 0, made: received, capital: 0 },
    totalCount: events.length,
    hasMore: false,
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderHistory(): Promise<Renderer> {
  let renderer: Renderer | undefined;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <ToastProvider>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="HistoryList" component={HistoryScreen} />
            <Stack.Screen name="TransactionForm" component={TransactionFormScreen} />
            <Stack.Screen name="AddMoney" component={AddMoneyScreen} />
            <Stack.Screen name="Debts" component={DebtsProbe as never} />
          </Stack.Navigator>
        </NavigationContainer>
      </ToastProvider>,
    );
  });
  await flush();
  return renderer!;
}

function texts(renderer: Renderer): string[] {
  return renderer.root
    .findAllByType(Text)
    .map(node => [node.props.children].flat(Infinity).join(''));
}

function pressable(renderer: Renderer, testID: string) {
  return renderer.root.find(
    node => node.props.testID === testID && typeof node.props.onPress === 'function',
  );
}

async function press(renderer: Renderer, testID: string) {
  await act(async () => {
    pressable(renderer, testID).props.onPress();
  });
  await flush();
}

function deleteDialog(renderer: Renderer) {
  return renderer.root
    .findAllByType(ConfirmDialog)
    .find(node => node.props.confirmTestID === 'transaction-delete-confirm')!;
}

describe('History detail sheet (KZ-07)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    debtsParams = null;
    (listActivity as jest.Mock).mockResolvedValue(
      response([SALE_ROW, CAPITAL_ROW, DEBT_ROW, PRODUCT_ROW], 4500),
    );
    (getTransaction as jest.Mock).mockImplementation(async (id: number) => ({
      transaction: id === SALE.id ? SALE : CAPITAL,
    }));
    (listItems as jest.Mock).mockResolvedValue({ items: [OIL] });
    (deleteTransaction as jest.Mock).mockResolvedValue(undefined);
    (createTransaction as jest.Mock).mockResolvedValue({ transaction: { ...SALE, id: 99 } });
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('opens a sale with its amount, date, item, quantity and description', async () => {
    const renderer = await renderHistory();
    await press(renderer, 'history-row-1');

    expect(getTransaction).toHaveBeenCalledWith(41);
    const shown = texts(renderer).join('|');
    expect(shown).toContain(en.transactions.detailTitle);
    expect(shown).toContain('+4 500 FCFA');
    expect(shown).toContain(DAY);
    expect(shown).toContain('Palm oil');
    expect(shown).toContain('|3|');
    expect(shown).toContain('Market day');
  });

  it('deletes after a translated confirmation, then reloads History', async () => {
    const renderer = await renderHistory();
    await press(renderer, 'history-row-1');
    await press(renderer, 'transaction-detail-delete');

    const dialog = deleteDialog(renderer);
    expect(dialog.props.visible).toBe(true);
    expect(dialog.props.title).toBe(en.transactions.deleteConfirmTitle);
    expect(deleteTransaction).not.toHaveBeenCalled();

    await act(async () => {
      await i18n.changeLanguage('fr');
    });
    expect(deleteDialog(renderer).props.title).toBe(fr.transactions.deleteConfirmTitle);
    expect(deleteDialog(renderer).props.confirmLabel).toBe(fr.transactions.delete);
    await act(async () => {
      await i18n.changeLanguage('wes');
    });
    expect(deleteDialog(renderer).props.title).toBe(wes.transactions.deleteConfirmTitle);

    // The server no longer has the sale: the reload drops the row and its total.
    (listActivity as jest.Mock).mockResolvedValue(response([CAPITAL_ROW, DEBT_ROW, PRODUCT_ROW], 0));
    const loadsBefore = (listActivity as jest.Mock).mock.calls.length;
    await act(async () => {
      deleteDialog(renderer).props.onConfirm();
    });
    await flush();

    expect(deleteTransaction).toHaveBeenCalledWith(41);
    expect((listActivity as jest.Mock).mock.calls.length).toBe(loadsBefore + 1);
    expect(renderer.root.findAll(node => node.props.testID === 'history-row-1')).toHaveLength(0);
    expect(deleteDialog(renderer).props.visible).toBe(false);
  });

  it('cancelling the confirmation deletes nothing', async () => {
    const renderer = await renderHistory();
    await press(renderer, 'history-row-1');
    await press(renderer, 'transaction-detail-delete');
    await act(async () => {
      deleteDialog(renderer).props.onCancel();
    });
    await flush();
    expect(deleteTransaction).not.toHaveBeenCalled();
    expect(deleteDialog(renderer).props.visible).toBe(false);
  });

  it('shows a failed delete as a translated message and keeps the row', async () => {
    (deleteTransaction as jest.Mock).mockRejectedValue(
      new ApiError(0, 'The server could not be reached.', 'SERVER_UNREACHABLE'),
    );
    const renderer = await renderHistory();
    await press(renderer, 'history-row-1');
    await press(renderer, 'transaction-detail-delete');
    await act(async () => {
      deleteDialog(renderer).props.onConfirm();
    });
    await flush();

    expect(texts(renderer)).toContain(en.errors.serverUnreachable);
    expect(renderer.root.findAll(node => node.props.testID === 'history-row-1').length).toBeGreaterThan(0);
  });

  it('Correct saves the new sale first and only then deletes the old one', async () => {
    const order: string[] = [];
    (createTransaction as jest.Mock).mockImplementation(async () => {
      order.push('create');
      return { transaction: { ...SALE, id: 99 } };
    });
    (deleteTransaction as jest.Mock).mockImplementation(async () => {
      order.push('delete');
    });
    const renderer = await renderHistory();
    await press(renderer, 'history-row-1');
    await press(renderer, 'transaction-detail-correct');

    // The form is prefilled from the stored record, item included.
    expect(pressable(renderer, 'transaction-save')).toBeTruthy();
    const amount = renderer.root.find(
      node => node.props.testID === 'transaction-amount' && typeof node.props.onChangeText === 'function',
    );
    expect(amount.props.value).toBe('4500');
    expect(texts(renderer)).toContain(en.transactions.correctTitle);
    expect(texts(renderer)).toContain('Palm oil');

    await act(async () => {
      amount.props.onChangeText('5 000');
    });
    await press(renderer, 'transaction-save');

    expect(order).toEqual(['create', 'delete']);
    expect((createTransaction as jest.Mock).mock.calls[0][0]).toMatchObject({
      type: 'sale',
      amount: 5000,
      date: DAY,
      itemId: 5,
      quantity: 3,
      description: 'Market day',
    });
    expect((createTransaction as jest.Mock).mock.calls[0][0].clientOpId).toEqual(expect.any(String));
    expect(deleteTransaction).toHaveBeenCalledWith(41);
    expect(texts(renderer)).toContain(en.transactions.corrected);
  });

  it('Correct never deletes the old record when the new one fails to save', async () => {
    (createTransaction as jest.Mock).mockRejectedValue(
      new ApiError(0, 'The server did not answer in time.', 'SERVER_UNREACHABLE'),
    );
    const renderer = await renderHistory();
    await press(renderer, 'history-row-1');
    await press(renderer, 'transaction-detail-correct');
    await press(renderer, 'transaction-save');
    await press(renderer, 'transaction-save');

    expect(createTransaction).toHaveBeenCalledTimes(2);
    // The retry is the same submission (KZ-11).
    const ids = (createTransaction as jest.Mock).mock.calls.map(call => call[0].clientOpId);
    expect(ids[1]).toBe(ids[0]);
    expect(deleteTransaction).not.toHaveBeenCalled();
    expect(texts(renderer)).toContain(en.errors.serverUnreachable);
  });

  it('Correct says so when the new record saved but the old one could not be removed', async () => {
    (deleteTransaction as jest.Mock).mockRejectedValue(
      new ApiError(0, 'The server could not be reached.', 'SERVER_UNREACHABLE'),
    );
    const renderer = await renderHistory();
    await press(renderer, 'history-row-1');
    await press(renderer, 'transaction-detail-correct');
    await press(renderer, 'transaction-save');

    expect(createTransaction).toHaveBeenCalledTimes(1);
    expect(texts(renderer)).toContain(en.transactions.correctOldNotRemoved);
  });

  it('an old record that is already gone counts as removed', async () => {
    (deleteTransaction as jest.Mock).mockRejectedValue(new ApiError(404, 'Not found', 'NOT_FOUND'));
    const renderer = await renderHistory();
    await press(renderer, 'history-row-1');
    await press(renderer, 'transaction-detail-correct');
    await press(renderer, 'transaction-save');
    expect(texts(renderer)).toContain(en.transactions.corrected);
  });

  it('Correct on money added opens the prefilled Add money form', async () => {
    const renderer = await renderHistory();
    await press(renderer, 'history-row-2');
    expect(getTransaction).toHaveBeenCalledWith(42);
    await press(renderer, 'transaction-detail-correct');

    const amount = renderer.root.find(
      node => node.props.testID === 'add-money-amount' && typeof node.props.onChangeText === 'function',
    );
    expect(amount.props.value).toBe('20000');
    expect(texts(renderer)).toContain(en.transactions.correctNote);
    await press(renderer, 'add-money-save');

    expect((createTransaction as jest.Mock).mock.calls[0][0]).toMatchObject({
      type: 'capital',
      amount: 20000,
      date: '2026-10-12',
      description: 'Savings',
    });
    expect(deleteTransaction).toHaveBeenCalledWith(42);
  });

  it('a debt row opens that debt in the Debts list; a product row opens nothing', async () => {
    const renderer = await renderHistory();
    expect(renderer.root.findAll(node => node.props.testID === 'history-row-4')).toHaveLength(0);

    await press(renderer, 'history-row-3');
    expect(debtsParams).toEqual({ debtId: 7 });
    expect(getTransaction).not.toHaveBeenCalled();
  });

  it('a legacy row without a reference opens nothing', async () => {
    (listActivity as jest.Mock).mockResolvedValue(
      response([event({ id: 9, type: 'sale', amount: 100 })], 100),
    );
    const renderer = await renderHistory();
    expect(renderer.root.findAll(node => node.props.testID === 'history-row-9')).toHaveLength(0);
  });
});
