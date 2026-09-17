import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ShieldCheck } from 'lucide-react-native';
import Screen from '../../components/ui/Screen';
import AppHeader from '../../components/ui/AppHeader';
import Card from '../../components/ui/Card';
import type { MoreStackParamList } from '../../navigation/RootNavigator';
import { colors, radius, spacing, typography } from '../../theme';

type ScreenProps = NativeStackScreenProps<MoreStackParamList, 'Privacy'>;

const PARAGRAPHS = [
  'privacy.p1',
  'privacy.p2',
  'privacy.p3',
  'privacy.p4',
] as const;

function PrivacyScreen({ navigation }: ScreenProps) {
  const { t } = useTranslation();

  return (
    <Screen scroll>
      <AppHeader title={t('more.privacy')} onBack={() => navigation.goBack()} />
      <View style={styles.content}>
        <Card>
          <View style={styles.headerRow}>
            <View style={styles.icon}>
              <ShieldCheck size={22} color={colors.primaryDark} />
            </View>
            <Text style={styles.heading}>{t('privacy.title')}</Text>
          </View>
          <Text style={styles.updated}>{t('privacy.updated')}</Text>
          {PARAGRAPHS.map(key => (
            <Text key={key} style={styles.paragraph}>
              {t(key)}
            </Text>
          ))}
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    marginTop: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  heading: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  updated: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.lg,
  },
  paragraph: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
});

export default PrivacyScreen;