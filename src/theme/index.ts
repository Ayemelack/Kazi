import { Platform } from 'react-native';

export const colors = {
  primary: '#007A5E',
  primaryDark: '#00614B',
  primarySoft: '#E3F2EC',
  accent: '#E8A33D',
  accentSoft: '#FDF3E0',
  background: '#F7F4EE',
  surface: '#FFFFFF',
  surfaceAlt: '#F2EEE6',
  textPrimary: '#1E2A26',
  textSecondary: '#5C6B64',
  textMuted: '#9AA69F',
  textOnPrimary: '#FFFFFF',
  border: '#E3DED4',
  success: '#1E8E3E',
  successSoft: '#E6F4EA',
  error: '#C62828',
  errorSoft: '#FCEBEB',
  warning: '#ED6C02',
  warningSoft: '#FEF0E1',
  disabled: '#E5E0D6',
  disabledText: '#A79B8C',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
  massive: 48,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
};

const systemFont = Platform.select({
  ios: 'System',
  default: 'sans-serif',
});

export const typography = {
  family: systemFont,
  display: { fontSize: 28, lineHeight: 36, fontWeight: '700' as const },
  title: { fontSize: 22, lineHeight: 30, fontWeight: '700' as const },
  heading: { fontSize: 18, lineHeight: 26, fontWeight: '600' as const },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' as const },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600' as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' as const },
};

export const shadows = {
  card: Platform.select({
    ios: {
      shadowColor: '#1E2A26',
      shadowOpacity: 0.06,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
    },
    android: { elevation: 2 },
    default: { elevation: 2 },
  }),
};

export const zIndex = {
  modal: 900,
  toast: 1000,
  offline: 980,
};

export const theme = {
  colors,
  spacing,
  radius,
  typography,
  shadows,
  zIndex,
};