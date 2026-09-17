import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { CloudOff, RefreshCw } from 'lucide-react-native';
import { colors, radius, spacing, typography, zIndex } from '../../theme';

// Small unobtrusive banner shown while the device can't reach the backend
// (or a change is still waiting to sync). Deliberately static and non-blocking:
// it sits under the toast area and never intercepts touches.

export function OfflinePill({
  online,
  pendingCount,
}: {
  online: boolean;
  pendingCount: number;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const label = useMemo(() => {
    if (!online) {
      return pendingCount > 0
        ? t('offline.offlineWithPending')
        : t('offline.youAreOffline');
    }
    return t('offline.syncPending');
  }, [online, pendingCount, t]);

  const Icon = online ? RefreshCw : CloudOff;
  const [bg, fg] = online
    ? [colors.warningSoft, colors.warning]
    : [colors.errorSoft, colors.error];

  return (
    <View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[
        styles.wrap,
        { top: insets.top + spacing.sm + 52, backgroundColor: bg },
      ]}
    >
      <Icon size={14} color={fg} />
      <Text style={[styles.label, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    zIndex: zIndex.offline,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    gap: spacing.xs,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  label: {
    ...typography.caption,
    fontWeight: '600',
    flexShrink: 1,
  },
});