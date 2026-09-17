import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronLeft, type LucideIcon } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { colors, spacing, typography } from '../../theme';

interface AppHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
  rightIcon?: LucideIcon;
  onRightPress?: () => void;
}

function AppHeader({
  title,
  subtitle,
  onBack,
  right,
  rightIcon: RightIcon,
  onRightPress,
}: AppHeaderProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={onBack}
          hitSlop={8}
          style={styles.sideButton}
        >
          <ChevronLeft size={26} color={colors.textPrimary} />
        </Pressable>
      ) : (
        <View style={styles.sidePlaceholder} />
      )}
      <View style={styles.center}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? (
        right
      ) : RightIcon ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRightPress}
          hitSlop={8}
          style={styles.sideButton}
        >
          <RightIcon size={24} color={colors.textPrimary} />
        </Pressable>
      ) : (
        <View style={styles.sidePlaceholder} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    minHeight: 52,
  },
  sideButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sidePlaceholder: {
    width: 44,
  },
  center: {
    flex: 1,
    alignItems: 'center',
  },
  title: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 1,
  },
});

export default AppHeader;