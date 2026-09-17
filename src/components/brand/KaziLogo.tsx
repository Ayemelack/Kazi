import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import KaziMark from './KaziMark';
import { colors, spacing, typography } from '../../theme';

interface Props {
  markSize?: number;
  textSize?: number;
}

function KaziLogo({ markSize = 36, textSize = 22 }: Props) {
  return (
    <View style={styles.row}>
      <KaziMark size={markSize} />
      <Text style={[styles.wordmark, { fontSize: textSize }]}>Kazi</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  wordmark: {
    ...typography.title,
    color: colors.textPrimary,
    letterSpacing: -0.4,
    marginLeft: spacing.sm + 2,
  },
});

export default React.memo(KaziLogo);