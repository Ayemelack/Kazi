import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type TextInputProps,
} from 'react-native';
import { Eye, EyeOff, type LucideIcon } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { colors, radius, spacing, typography } from '../../theme';

interface TextFieldProps {
  label?: string;
  error?: string;
  hint?: string;
  secure?: boolean;
  leftIcon?: LucideIcon;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  multiline?: boolean;
  maxLength?: number;
  autoCapitalize?: TextInputProps['autoCapitalize'];
  onBlur?: () => void;
  testID?: string;
}

function TextField({
  label,
  error,
  hint,
  secure = false,
  leftIcon: LeftIcon,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline = false,
  maxLength,
  autoCapitalize,
  onBlur,
  testID,
}: TextFieldProps) {
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(!secure);

  const borderColor = error
    ? colors.error
    : focused
    ? colors.primary
    : colors.border;

  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View
        style={[
          styles.inputWrap,
          { borderColor },
          error && styles.inputError,
          multiline && styles.inputMultiline,
        ]}
      >
        {LeftIcon ? (
          <LeftIcon
            size={20}
            color={focused ? colors.primary : colors.textMuted}
            style={styles.icon}
          />
        ) : null}
        <TextInput
          testID={testID}
          style={[styles.input, multiline && styles.inputMultilineText]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          secureTextEntry={secure && !visible}
          keyboardType={keyboardType}
          multiline={multiline}
          maxLength={maxLength}
          autoCapitalize={autoCapitalize ?? 'none'}
          autoCorrect={false}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
        />
        {secure ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={visible ? t('common.hidePassword') : t('common.showPassword')}
            hitSlop={8}
            onPress={() => setVisible(v => !v)}
            style={styles.iconButton}
          >
            {visible ? (
              <EyeOff size={20} color={colors.textSecondary} />
            ) : (
              <Eye size={20} color={colors.textSecondary} />
            )}
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!error && hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.lg,
  },
  label: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    minHeight: 52,
  },
  inputError: {
    borderColor: colors.error,
  },
  inputMultiline: {
    minHeight: 104,
    alignItems: 'flex-start',
  },
  icon: {
    marginRight: spacing.sm,
  },
  input: {
    flex: 1,
    ...typography.body,
    color: colors.textPrimary,
    paddingVertical: spacing.md,
  },
  inputMultilineText: {
    textAlignVertical: 'top',
  },
  iconButton: {
    paddingLeft: spacing.md,
    paddingVertical: spacing.sm,
  },
  error: {
    ...typography.caption,
    color: colors.error,
    marginTop: spacing.xs + 2,
  },
  hint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs + 2,
  },
});

export default TextField;