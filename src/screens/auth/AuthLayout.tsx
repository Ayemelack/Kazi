import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Screen from '../../components/ui/Screen';
import Card from '../../components/ui/Card';
import KaziLogo from '../../components/brand/KaziLogo';
import { colors, spacing, typography } from '../../theme';

interface AuthLayoutProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

function AuthLayout({ title, subtitle, children }: AuthLayoutProps) {
  return (
    <Screen scroll>
      <View style={styles.logoWrap}>
        <KaziLogo markSize={44} textSize={24} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      <Card>
        <View style={styles.form}>{children}</View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  logoWrap: {
    alignItems: 'center',
    marginTop: spacing.xxxl,
    marginBottom: spacing.xxl,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.xl,
  },
  form: {
    paddingVertical: spacing.xs,
  },
});

export default AuthLayout;