import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LifeBuoy, Mail, MessageCircle } from 'lucide-react-native';
import Screen from '../../components/ui/Screen';
import AppHeader from '../../components/ui/AppHeader';
import Card from '../../components/ui/Card';
import type { MoreStackParamList } from '../../navigation/RootNavigator';
import { colors, radius, spacing, typography } from '../../theme';

type ScreenProps = NativeStackScreenProps<MoreStackParamList, 'Support'>;

function SupportScreen({ navigation }: ScreenProps) {
  const { t } = useTranslation();

  return (
    <Screen scroll>
      <AppHeader title={t('more.support')} onBack={() => navigation.goBack()} />
      <View style={styles.content}>
        <Card>
          <View style={styles.headerRow}>
            <View style={styles.icon}>
              <LifeBuoy size={22} color={colors.primaryDark} />
            </View>
            <View style={styles.headerText}>
              <Text style={styles.title}>{t('support.title')}</Text>
              <Text style={styles.message}>{t('support.message')}</Text>
            </View>
          </View>
        </Card>

        <Card>
          <Text style={styles.entryLabel}>{t('support.whatWeCanHelpWith')}</Text>
          <Text style={styles.body}>{t('support.howToHelp')}</Text>
        </Card>

        <Card>
          <View style={styles.contactRow}>
            <View style={styles.contactIcon}>
              <Mail size={18} color={colors.primaryDark} />
            </View>
            <Text style={styles.contactLabel}>{t('support.email')}</Text>
            <Text style={styles.contactValue}>support@kazi.app</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.contactRow}>
            <View style={styles.contactIcon}>
              <MessageCircle size={18} color={colors.primaryDark} />
            </View>
            <Text style={styles.contactLabel}>{t('support.responseLabel')}</Text>
            <Text style={styles.contactValue}>{t('support.responseTime')}</Text>
          </View>
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    marginTop: spacing.md,
    gap: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  headerText: {
    flex: 1,
  },
  title: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  message: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  entryLabel: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  body: {
    ...typography.body,
    color: colors.textPrimary,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  contactIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  contactLabel: {
    flex: 1,
    ...typography.body,
    color: colors.textSecondary,
  },
  contactValue: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
});

export default SupportScreen;