import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  Building2,
  ChevronRight,
  FileText,
  HeartHandshake,
  LifeBuoy,
  LogOut,
  ShieldCheck,
  Trash2,
  type LucideIcon,
} from 'lucide-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import Screen from '../../components/ui/Screen';
import AppHeader from '../../components/ui/AppHeader';
import Card from '../../components/ui/Card';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { useToast } from '../../components/ui/Toast';
import { setAppLanguage, type AppLanguage } from '../../i18n';
import { useAuth } from '../../auth/AuthContext';
import type { MoreStackParamList } from '../../navigation/RootNavigator';
import { colors, radius, spacing, typography } from '../../theme';

const LANGUAGES: AppLanguage[] = ['en', 'fr', 'pid'];

type ScreenProps = NativeStackScreenProps<MoreStackParamList, 'MoreHome'>;

const MENU_ITEMS: {
  key: string;
  labelKey: string;
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
  screen: keyof MoreStackParamList;
}[] = [
  { key: 'business', labelKey: 'more.myBusiness', icon: Building2, iconColor: colors.primaryDark, iconBg: colors.primarySoft, screen: 'MyBusiness' },
  { key: 'feedback', labelKey: 'more.feedback', icon: HeartHandshake, iconColor: colors.primaryDark, iconBg: colors.primarySoft, screen: 'Feedback' },
  { key: 'support', labelKey: 'more.support', icon: LifeBuoy, iconColor: colors.primaryDark, iconBg: colors.primarySoft, screen: 'Support' },
  { key: 'privacy', labelKey: 'more.privacy', icon: ShieldCheck, iconColor: colors.primaryDark, iconBg: colors.primarySoft, screen: 'Privacy' },
  { key: 'terms', labelKey: 'more.terms', icon: FileText, iconColor: colors.primaryDark, iconBg: colors.primarySoft, screen: 'Terms' },
  { key: 'delete', labelKey: 'more.deleteAccount', icon: Trash2, iconColor: colors.error, iconBg: colors.errorSoft, screen: 'DeleteAccount' },
];

export default function MoreScreen({ navigation }: ScreenProps) {
  const { t, i18n } = useTranslation();
  const { user, logOut } = useAuth();
  const toast = useToast();
  const current = (['en', 'fr', 'pid'] as const).includes(i18n.language as AppLanguage)
    ? (i18n.language as AppLanguage)
    : 'en';
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const confirmSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await logOut();
      toast.show('success', t('auth.loggedOut'));
    } finally {
      setSigningOut(false);
      setConfirmingSignOut(false);
    }
  };

  return (
    <Screen>
      <AppHeader title={t('navigation.more')} />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Card>
          <View style={styles.accountRow}>
            <View style={styles.avatar}>
              <Building2 size={20} color={colors.primaryDark} />
            </View>
            <View style={styles.accountText}>
              <Text style={styles.accountName} numberOfLines={1}>
                {user?.companyName.trim()
                  ? user.companyName
                  : `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim() || t('auth.account')}
              </Text>
              <Text style={styles.accountEmail} numberOfLines={1}>
                {user ? `${user.firstName} ${user.lastName}`.trim() : t('auth.signedInAs')}
              </Text>
            </View>
          </View>
        </Card>

        {MENU_ITEMS.map(item => (
          <Pressable
            key={item.key}
            testID={`more-${item.key}`}
            accessibilityRole="button"
            onPress={() => navigation.navigate(item.screen)}
            style={({ pressed }) => [styles.menuRow, pressed && styles.rowPressed]}
          >
            <View style={[styles.menuIcon, { backgroundColor: item.iconBg }]}>
              <item.icon size={20} color={item.iconColor} />
            </View>
            <Text style={styles.menuLabel}>{t(item.labelKey)}</Text>
            <ChevronRight size={20} color={colors.textMuted} />
          </Pressable>
        ))}

        <Card padded={false}>
          <Text style={styles.sectionLabel}>{t('moreScreen.language')}</Text>
          <View style={styles.languageRow}>
            {LANGUAGES.map(language => {
              const active = current === language;
              return (
                <Pressable
                  key={language}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setAppLanguage(language)}
                  style={[
                    styles.languageButton,
                    active ? styles.languageActive : styles.languageInactive,
                  ]}
                >
                  <Text
                    style={[
                      styles.languageLabel,
                      { color: active ? colors.primaryDark : colors.textSecondary },
                    ]}
                  >
                    {t(
                      language === 'en'
                        ? 'moreScreen.english'
                        : language === 'fr'
                        ? 'moreScreen.french'
                        : 'moreScreen.pidgin',
                    )}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Card>

        <Pressable
          accessibilityRole="button"
          onPress={() => setConfirmingSignOut(true)}
          style={[styles.signOutRow]}
        >
          <LogOut size={20} color={colors.error} />
          <Text style={styles.signOutLabel}>{t('auth.signOut')}</Text>
        </Pressable>
      </ScrollView>

      <ConfirmDialog
        visible={confirmingSignOut}
        title={t('auth.signOutConfirmTitle')}
        message={t('auth.signOutConfirmMessage')}
        confirmLabel={t('auth.signOut')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        loading={signingOut}
        onConfirm={confirmSignOut}
        onCancel={() => setConfirmingSignOut(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  accountText: {
    flex: 1,
  },
  accountName: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  accountEmail: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowPressed: {
    opacity: 0.85,
  },
  menuIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  menuLabel: {
    flex: 1,
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  sectionLabel: {
    ...typography.label,
    color: colors.textMuted,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  languageRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  languageButton: {
    flex: 1,
    borderRadius: 999,
  },
  languageActive: {
    backgroundColor: colors.primarySoft,
  },
  languageInactive: {
    backgroundColor: colors.surfaceAlt,
  },
  languageLabel: {
    ...typography.heading,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
  signOutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
  },
  signOutLabel: {
    ...typography.body,
    color: colors.error,
    marginLeft: spacing.sm,
    fontWeight: '600',
  },
});