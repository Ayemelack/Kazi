import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CalendarDays } from 'lucide-react-native';
import { colors, radius, spacing, typography } from '../../theme';
import DatePickerModal from './DatePickerModal';

interface DatePickerFieldProps {
  label?: string;
  error?: string;
  hint?: string;
  value: string;
  onChange: (date: string) => void;
  testID?: string;
}

function DatePickerField({ label, error, hint, value, onChange, testID }: DatePickerFieldProps) {
  const [visible, setVisible] = useState(false);

  const borderColor = error ? colors.error : colors.border;

  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <Pressable
        testID={testID}
        accessibilityRole="button"
        onPress={() => setVisible(true)}
        style={({ pressed }) => [
          styles.field,
          { borderColor },
          error && styles.fieldError,
          pressed && styles.fieldPressed,
        ]}
      >
        <Text style={styles.value}>{value}</Text>
        <CalendarDays size={18} color={colors.textMuted} style={styles.icon} />
      </Pressable>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {!error && hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <DatePickerModal
        visible={visible}
        value={value}
        onSelect={onChange}
        onClose={() => setVisible(false)}
      />
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
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    minHeight: 52,
  },
  fieldError: {
    borderColor: colors.error,
  },
  fieldPressed: {
    opacity: 0.88,
  },
  value: {
    flex: 1,
    ...typography.body,
    color: colors.textPrimary,
    paddingVertical: spacing.md,
  },
  icon: {
    marginLeft: spacing.sm,
  },
  errorText: {
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

export default DatePickerField;
