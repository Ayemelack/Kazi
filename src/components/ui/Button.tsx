import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { colors, radius, spacing, typography } from '../../theme';

type Variant = 'primary' | 'secondary' | 'outline' | 'destructive' | 'ghost';
type Size = 'md' | 'lg';

interface ButtonProps {
  onPress?: () => void;
  label: string;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  icon?: LucideIcon;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const HEIGHTS: Record<Size, number> = {
  md: 48,
  lg: 56,
};

const BACKGROUND: Record<Variant, string> = {
  primary: colors.primary,
  secondary: colors.primarySoft,
  outline: colors.surface,
  destructive: colors.error,
  ghost: 'transparent',
};

const FOREGROUND: Record<Variant, string> = {
  primary: colors.textOnPrimary,
  secondary: colors.primaryDark,
  outline: colors.primaryDark,
  destructive: colors.textOnPrimary,
  ghost: colors.textSecondary,
};

function Button({
  onPress,
  label,
  variant = 'primary',
  size = 'lg',
  disabled = false,
  loading = false,
  icon: Icon,
  style,
  testID,
}: ButtonProps) {
  const pressed = disabled || loading;
  const IconComponent = Icon;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: pressed, busy: loading }}
      disabled={pressed}
      onPress={onPress}
      style={({ pressed: isPressed }) => [
        styles.base,
        {
          height: HEIGHTS[size],
          backgroundColor: BACKGROUND[variant],
          borderWidth: variant === 'outline' ? 1.5 : 0,
          borderColor: colors.primary,
        },
        pressed && styles.disabled,
        isPressed && !pressed && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={FOREGROUND[variant]} />
      ) : (
        <>
          {IconComponent ? <IconComponent size={20} color={FOREGROUND[variant]} /> : null}
          <Text
            style={[
              styles.label,
              { color: pressed ? colors.disabledText : FOREGROUND[variant] },
              IconComponent ? styles.withIcon : null,
            ]}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
  },
  pressed: {
    opacity: 0.88,
  },
  disabled: {
    backgroundColor: colors.disabled,
  },
  label: {
    ...typography.heading,
    lineHeight: 22,
    fontWeight: '600',
  },
  withIcon: {
    marginLeft: spacing.sm,
  },
});

export default Button;