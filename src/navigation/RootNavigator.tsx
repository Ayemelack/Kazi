import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  NavigationContainer,
  DefaultTheme,
  type NavigatorScreenParams,
  type RouteProp,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import { History, House, MoreHorizontal, Package, type LucideIcon } from 'lucide-react-native';
import HomeScreen from '../screens/home/HomeScreen';
import ProductsScreen from '../screens/products/ProductsScreen';
import HistoryScreen from '../screens/history/HistoryScreen';
import MoreScreen from '../screens/more/MoreScreen';
import LoginScreen from '../screens/auth/LoginScreen';
import SignupScreen from '../screens/auth/SignupScreen';
import WelcomeScreen from '../screens/auth/WelcomeScreen';
import ForgotPasswordScreen from '../screens/auth/ForgotPasswordScreen';
import ResetPasswordScreen from '../screens/auth/ResetPasswordScreen';
import BusinessProfileScreen from '../screens/business/BusinessProfileScreen';
import LoadingView from '../components/ui/LoadingView';
import { useAuth } from '../auth/AuthContext';
import ProductFormScreen from '../screens/products/ProductFormScreen';
import TransactionFormScreen from '../screens/history/TransactionFormScreen';
import AddMoneyScreen from '../screens/history/AddMoneyScreen';
import DebtsScreen from '../screens/debts/DebtsScreen';
import DebtFormScreen from '../screens/debts/DebtFormScreen';
import MyBusinessScreen from '../screens/more/MyBusinessScreen';
import ReminderScreen from '../screens/more/ReminderScreen';
import FeedbackScreen from '../screens/more/FeedbackScreen';
import SupportScreen from '../screens/more/SupportScreen';
import PrivacyScreen from '../screens/more/PrivacyScreen';
import TermsScreen from '../screens/more/TermsScreen';
import DeleteAccountScreen from '../screens/more/DeleteAccountScreen';
import AppLockScreen from '../screens/more/AppLockScreen';
import AppLockUnlockScreen from '../screens/applock/AppLockUnlockScreen';
import { AppLockProvider, useAppLock } from '../applock/AppLockContext';
import { navigationRef, setPushNavigator } from '../notifications/pushNavigation';
import { consumeInitialNotificationNavigation } from '../notifications/service';
import { colors } from '../theme';
import type { TransactionCorrection } from '../transactions/types';

export type MainTabParamList = {
  Home: undefined;
  Products: undefined;
  History: NavigatorScreenParams<HistoryStackParamList> | undefined;
  More: NavigatorScreenParams<MoreStackParamList> | undefined;
};

export type RootStackParamList = {
  // Nested so a push can open a tab (and a screen inside it) directly.
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  BusinessProfile: undefined;
};

export type AuthStackParamList = {
  Welcome: undefined;
  Login: undefined;
  Signup: undefined;
  ForgotPassword: undefined;
  // The email the code was sent to, and when it was asked for (KZ-06). Never
  // the code itself.
  ResetPassword: { email: string; requestedAt?: number };
};

export type ProductsStackParamList = {
  ProductsList: undefined;
  ProductForm: { itemId?: number } | undefined;
};

export type HistoryStackParamList = {
  HistoryList: undefined;
  // `correct`: the record being corrected (KZ-07); the form is prefilled
  // from it and deletes it after the new record is saved.
  TransactionForm:
    | { initialType?: 'sale' | 'purchase'; correct?: TransactionCorrection }
    | undefined;
  AddMoney: { correct?: TransactionCorrection } | undefined;
  // `debtId`: the debt to highlight, when opened from a History row.
  Debts: { debtId?: number } | undefined;
  DebtForm: undefined;
};

export type MoreStackParamList = {
  MoreHome: undefined;
  MyBusiness: undefined;
  Reminder: undefined;
  AppLock: undefined;
  Feedback: undefined;
  Support: undefined;
  Privacy: undefined;
  Terms: undefined;
  DeleteAccount: undefined;
};

type TabRoute = RouteProp<MainTabParamList, keyof MainTabParamList>;

const Tab = createBottomTabNavigator<MainTabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();
const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const ProductsStackNav = createNativeStackNavigator<ProductsStackParamList>();
const HistoryStackNav = createNativeStackNavigator<HistoryStackParamList>();
const MoreStackNav = createNativeStackNavigator<MoreStackParamList>();

const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.primary,
    background: colors.background,
    card: colors.surface,
    text: colors.textPrimary,
    border: colors.border,
    notification: colors.primary,
  },
};

const TAB_ICONS: Record<keyof MainTabParamList, LucideIcon> = {
  Home: House,
  Products: Package,
  History: History,
  More: MoreHorizontal,
};

const renderTabIcon =
  (routeName: keyof MainTabParamList) =>
  ({ color, size }: { color: string; size: number }) => {
    const Icon = TAB_ICONS[routeName];
    return <Icon size={size} color={color} />;
  };

function ProductsNavigator() {
  return (
    <ProductsStackNav.Navigator screenOptions={{ headerShown: false }}>
      <ProductsStackNav.Screen name="ProductsList" component={ProductsScreen} />
      <ProductsStackNav.Screen name="ProductForm" component={ProductFormScreen} />
    </ProductsStackNav.Navigator>
  );
}

function HistoryNavigator() {
  return (
    <HistoryStackNav.Navigator screenOptions={{ headerShown: false }}>
      <HistoryStackNav.Screen name="HistoryList" component={HistoryScreen} />
      <HistoryStackNav.Screen name="TransactionForm" component={TransactionFormScreen} />
      <HistoryStackNav.Screen name="AddMoney" component={AddMoneyScreen} />
      <HistoryStackNav.Screen name="Debts" component={DebtsScreen} />
      <HistoryStackNav.Screen name="DebtForm" component={DebtFormScreen} />
    </HistoryStackNav.Navigator>
  );
}

function MoreNavigator() {
  return (
    <MoreStackNav.Navigator screenOptions={{ headerShown: false }}>
      <MoreStackNav.Screen name="MoreHome" component={MoreScreen} />
      <MoreStackNav.Screen name="MyBusiness" component={MyBusinessScreen} />
      <MoreStackNav.Screen name="Reminder" component={ReminderScreen} />
      <MoreStackNav.Screen name="AppLock" component={AppLockScreen} />
      <MoreStackNav.Screen name="Feedback" component={FeedbackScreen} />
      <MoreStackNav.Screen name="Support" component={SupportScreen} />
      <MoreStackNav.Screen name="Privacy" component={PrivacyScreen} />
      <MoreStackNav.Screen name="Terms" component={TermsScreen} />
      <MoreStackNav.Screen name="DeleteAccount" component={DeleteAccountScreen} />
    </MoreStackNav.Navigator>
  );
}

function MainTabs() {
  const { t } = useTranslation();

  const tabLabels: Record<keyof MainTabParamList, string> = {
    Home: t('tabs.home'),
    Products: t('tabs.products'),
    History: t('tabs.history'),
    More: t('tabs.more'),
  };

  return (
    <Tab.Navigator
      screenOptions={({ route }: { route: TabRoute }) => ({
        headerShown: false,
        tabBarLabel: tabLabels[route.name as keyof MainTabParamList],
        tabBarIcon: renderTabIcon(route.name as keyof MainTabParamList),
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: { fontWeight: '600' },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Products" component={ProductsNavigator} />
      <Tab.Screen name="History" component={HistoryNavigator} />
      <Tab.Screen name="More" component={MoreNavigator} />
    </Tab.Navigator>
  );
}

function AppStack() {
  const { user } = useAuth();
  const hasBusiness = user?.hasBusiness ?? false;

  // A push tapped before this stack existed (background, terminated, signed
  // out) queues its navigation; registering here is what flushes it, and the
  // tap that launched the app is consumed here too.
  useEffect(() => {
    setPushNavigator(navigationRef);
    consumeInitialNotificationNavigation().catch(() => {});
    return () => setPushNavigator(null);
  }, []);

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {hasBusiness ? (
        <Stack.Screen name="Main" component={MainTabs} />
      ) : (
        <Stack.Screen
          name="BusinessProfile"
          component={BusinessProfileScreen}
          options={{ gestureEnabled: false }}
        />
      )}
    </Stack.Navigator>
  );
}

function AuthFlow() {
  return (
    <AuthStack.Navigator
      initialRouteName="Welcome"
      screenOptions={{ headerShown: false }}
    >
      <AuthStack.Screen name="Welcome" component={WelcomeScreen} />
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Signup" component={SignupScreen} />
      <AuthStack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
      <AuthStack.Screen name="ResetPassword" component={ResetPasswordScreen} />
    </AuthStack.Navigator>
  );
}

function AppLockGate() {
  const { ready, enabled, locked } = useAppLock();
  const { status } = useAuth();

  if (!ready || status !== 'authenticated' || !enabled || !locked) {
    return null;
  }

  return (
    <View style={styles.lockOverlay} testID="applock-overlay">
      <AppLockUnlockScreen />
    </View>
  );
}

function RootNavigator() {
  const { status } = useAuth();

  if (status === 'loading') {
    return <LoadingView />;
  }

  return (
    <AppLockProvider>
      <View style={styles.root}>
        <NavigationContainer ref={navigationRef} theme={navigationTheme}>
          {status === 'authenticated' ? <AppStack /> : <AuthFlow />}
        </NavigationContainer>
        <AppLockGate />
      </View>
    </AppLockProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  lockOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background,
  },
});

export default RootNavigator;