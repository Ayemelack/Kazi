// KZ-22: every form shows why Save is disabled, and no raw translation key
// can ever render as an error.
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import i18n from '../src/i18n';
import en from '../src/i18n/locales/en';
import fr from '../src/i18n/locales/fr';
import wes from '../src/i18n/locales/wes';
import { ToastProvider } from '../src/components/ui/Toast';
import LoginScreen from '../src/screens/auth/LoginScreen';
import SignupScreen from '../src/screens/auth/SignupScreen';
import ForgotPasswordScreen from '../src/screens/auth/ForgotPasswordScreen';
import ResetPasswordScreen from '../src/screens/auth/ResetPasswordScreen';
import BusinessProfileScreen from '../src/screens/business/BusinessProfileScreen';
import MyBusinessScreen from '../src/screens/more/MyBusinessScreen';
import FeedbackScreen from '../src/screens/more/FeedbackScreen';
import DebtFormScreen from '../src/screens/debts/DebtFormScreen';
import AddMoneyScreen from '../src/screens/history/AddMoneyScreen';
import TransactionFormScreen from '../src/screens/history/TransactionFormScreen';
import ProductFormScreen from '../src/screens/products/ProductFormScreen';
import StockMovementDialog from '../src/screens/products/StockMovementDialog';
import * as authValidation from '../src/auth/validation';
import * as debtValidation from '../src/debts/validation';
import * as itemValidation from '../src/items/validation';
import * as transactionValidation from '../src/transactions/validation';

const { logInMock } = jest.requireMock('../src/auth/AuthContext') as { logInMock: jest.Mock };

jest.mock('../src/offline/api', () => ({
  createTransaction: jest.fn(async () => ({ transaction: {} })),
  fetchSummary: jest.fn(async () => ({ summary: { totalCapital: 0 } })),
  listItems: jest.fn(async () => ({ items: [] })),
  createDebt: jest.fn(async () => ({ debt: {} })),
  getItem: jest.fn(),
  createItem: jest.fn(async () => ({ item: {} })),
  updateItem: jest.fn(),
  deleteItem: jest.fn(),
  stockIn: jest.fn(),
  stockOut: jest.fn(),
}));

jest.mock('../src/feedback/api', () => ({ submitFeedback: jest.fn(async () => ({})) }));

jest.mock('../src/auth/AuthContext', () => {
  const logIn = jest.fn(async () => undefined);
  return {
    logInMock: logIn,
    useAuth: () => ({
      user: { firstName: '', lastName: '', companyName: '', businessType: '' },
      logIn,
      signUp: jest.fn(async () => undefined),
      requestPasswordReset: jest.fn(async () => ({ message: '' })),
      resetPassword: jest.fn(async () => undefined),
      completeBusinessProfile: jest.fn(async () => undefined),
      updateAccountNames: jest.fn(async () => undefined),
    }),
  };
});

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

// What the KZ-22 acceptance test forbids on screen: a bare i18n key.
const RAW_KEY = /^[a-z]+(\.[a-zA-Z]+)+$/;

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

async function renderStockDialog(): Promise<Renderer> {
  let renderer: Renderer | undefined;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <StockMovementDialog
        visible
        direction="in"
        itemName="Rice"
        busy={false}
        error={null}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    );
  });
  await flush();
  return renderer!;
}

function allText(renderer: Renderer): string[] {
  return renderer.root
    .findAllByType(Text)
    .map(node => [node.props.children].flat(Infinity).join(''))
    .filter(text => text.length > 0);
}

// Errors shown next to fields: a field's `error` prop, or a Text whose testID
// ends in "-error" (the feedback rating).
function fieldErrors(renderer: Renderer): string[] {
  const props = renderer.root
    .findAll(node => typeof node.props.error === 'string' && node.props.error.length > 0)
    .map(node => node.props.error as string);
  const texts = renderer.root
    .findAll(node => node.type === Text && /-error$/.test(String(node.props.testID ?? '')))
    .map(node => [node.props.children].flat(Infinity).join(''));
  return [...new Set([...props, ...texts])];
}

function saveButton(renderer: Renderer, testID: string) {
  return renderer.root.find(
    node => node.props.testID === testID && node.props.accessibilityState !== undefined,
  );
}

function expectVisibleReasonWhenDisabled(renderer: Renderer, testID: string) {
  const disabled = saveButton(renderer, testID).props.accessibilityState.disabled === true;
  if (disabled) {
    expect(fieldErrors(renderer).length).toBeGreaterThan(0);
  }
}

function expectNoRawKeys(renderer: Renderer) {
  expect(allText(renderer).filter(text => RAW_KEY.test(text))).toEqual([]);
}

async function pressSave(renderer: Renderer, testID: string) {
  await act(async () => {
    saveButton(renderer, testID).props.onPress();
  });
  await flush();
}

const FORMS: Array<[string, () => Promise<Renderer>, string]> = [
  ['Login', () => renderForm(LoginScreen as never), 'login-submit'],
  ['Signup', () => renderForm(SignupScreen as never), 'signup-submit'],
  ['ForgotPassword', () => renderForm(ForgotPasswordScreen as never), 'forgot-submit'],
  [
    'ResetPassword',
    () => renderForm(ResetPasswordScreen as never, { token: 'reset-code-123' }),
    'reset-submit',
  ],
  ['BusinessProfile', () => renderForm(BusinessProfileScreen as never), 'business-submit'],
  ['MyBusiness', () => renderForm(MyBusinessScreen as never), 'mybusiness-save'],
  ['Feedback', () => renderForm(FeedbackScreen as never), 'feedback-submit'],
  ['DebtForm', () => renderForm(DebtFormScreen as never), 'debt-submit'],
  ['AddMoney', () => renderForm(AddMoneyScreen as never), 'add-money-save'],
  ['TransactionForm', () => renderForm(TransactionFormScreen as never), 'transaction-save'],
  ['ProductForm', () => renderForm(ProductFormScreen as never), 'item-save'],
  ['StockMovementDialog', renderStockDialog, 'stock-confirm'],
];

describe.each(FORMS)('%s form (KZ-22)', (_, render, saveID) => {
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('shows no errors before the user does anything, and Save is enabled', async () => {
    const renderer = await render();
    expect(fieldErrors(renderer)).toEqual([]);
    expect(saveButton(renderer, saveID).props.accessibilityState.disabled).toBe(false);
  });

  it('on a Save attempt shows translated reasons and only then disables Save', async () => {
    const renderer = await render();
    await pressSave(renderer, saveID);

    expect(fieldErrors(renderer).length).toBeGreaterThan(0);
    expect(saveButton(renderer, saveID).props.accessibilityState.disabled).toBe(true);
    expectVisibleReasonWhenDisabled(renderer, saveID);
    expectNoRawKeys(renderer);

    for (const lng of ['fr', 'wes']) {
      await act(async () => {
        await i18n.changeLanguage(lng);
      });
      expectVisibleReasonWhenDisabled(renderer, saveID);
      expectNoRawKeys(renderer);
    }
  });

  it('keeps a visible reason whenever Save is disabled while fields are edited', async () => {
    const renderer = await render();
    const inputs = renderer.root.findAllByType(TextInput);
    for (const input of inputs) {
      await act(async () => {
        input.props.onChangeText?.('x');
        input.props.onBlur?.({});
      });
      expectVisibleReasonWhenDisabled(renderer, saveID);
      expectNoRawKeys(renderer);
    }
  });
});

describe('field errors appear on blur (KZ-22)', () => {
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('shows only the left field\'s error and blocks Save', async () => {
    const renderer = await renderForm(LoginScreen as never);
    const email = renderer.root.find(
      node => node.type === TextInput && node.props.testID === 'login-email',
    );
    await act(async () => {
      email.props.onBlur({});
    });

    expect(fieldErrors(renderer)).toEqual([en.auth.errors.required]);
    expect(saveButton(renderer, 'login-submit').props.accessibilityState.disabled).toBe(true);

    await act(async () => {
      email.props.onChangeText('ada@example.cm');
    });
    expect(fieldErrors(renderer)).toEqual([]);
    expect(saveButton(renderer, 'login-submit').props.accessibilityState.disabled).toBe(false);
  });

  it('re-translates visible field errors when the language changes', async () => {
    const renderer = await renderForm(LoginScreen as never);
    await pressSave(renderer, 'login-submit');
    expect(fieldErrors(renderer)).toEqual([en.auth.errors.required]);
    expect(logInMock).not.toHaveBeenCalled();

    await act(async () => {
      await i18n.changeLanguage('fr');
    });
    expect(fieldErrors(renderer)).toEqual([fr.auth.errors.required]);
  });
});

describe('validator keys (KZ-22)', () => {
  // Inputs chosen to reach every branch of every validator.
  const SAMPLES = [
    '',
    ' ',
    'a',
    'ab',
    'Ab',
    'x'.repeat(300),
    'abc',
    'abcdefgh',
    '12345678',
    'abcd1234',
    `a1${'é'.repeat(40)}`,
    'a@b',
    'ada@example.cm',
    'Awa 2',
    '0',
    '1',
    '-1',
    '1,5',
    '1,000',
    '1e3',
    '99999999999999999',
    '2026-02-30',
    '1999-12-31',
    '2999-01-01',
    '2026-01-15',
  ];
  const LOCALES = { en, fr, wes } as Record<string, object>;

  function collectKeys(): Set<string> {
    const keys = new Set<string>();
    const add = (value: unknown) => {
      if (typeof value === 'string') {
        keys.add(value);
      } else if (value && typeof value === 'object') {
        Object.values(value).forEach(add);
      }
    };
    for (const s of SAMPLES) {
      for (const other of SAMPLES.slice(0, 4)) {
        add(authValidation.validateSignup({ firstName: s, lastName: s, email: s, password: s }));
        add(authValidation.validateLogin({ email: s, password: s }));
        add(authValidation.validateProfile({ companyName: s, businessType: s }));
        add(authValidation.validateConfirmPassword(s, other));
        add(debtValidation.validateDebt({ name: s, amount: s, date: s, note: s }));
        add(itemValidation.validateStockQuantity(s));
        add(
          itemValidation.validateItemForm({
            name: s,
            type: 'product',
            price: s,
            notes: s,
            trackStock: true,
            lowStockThreshold: s,
          }),
        );
        for (const type of ['sale', 'purchase', 'capital'] as const) {
          add(
            transactionValidation.validateTransactionForm(
              { type, amount: s, description: other, date: s, quantity: s },
              true,
              false,
            ),
          );
        }
      }
    }
    return keys;
  }

  it('every key a validator returns exists in every language', () => {
    const keys = collectKeys();
    expect(keys.size).toBeGreaterThan(20);
    for (const [lng, locale] of Object.entries(LOCALES)) {
      const missing = [...keys].filter(key => {
        const value = key
          .split('.')
          .reduce<unknown>(
            (node, part) =>
              node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
            locale,
          );
        return typeof value !== 'string';
      });
      expect({ lng, missing }).toEqual({ lng, missing: [] });
    }
  });
});
