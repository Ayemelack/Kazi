import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LogIn, UserPlus } from 'lucide-react-native';
import Screen from '../../components/ui/Screen';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import KaziLogo from '../../components/brand/KaziLogo';
import WelcomeVisual from '../../components/brand/WelcomeVisual';
import type { AuthStackParamList } from '../../navigation/RootNavigator';
import { colors, spacing, typography } from '../../theme';

type ScreenProps = NativeStackScreenProps<AuthStackParamList, 'Welcome'>;

function WelcomeScreen({ navigation }: ScreenProps) {
  const { t } = useTranslation();

  return (
    <Screen scroll>
      <View style={styles.logoWrap}>
        <KaziLogo markSize={48} textSize={27} />
      </View>
      <Text style={styles.tagline}>{t('empty.homeMessage')}</Text>
      <Text style={styles.message}>{t('welcome.message')}</Text>
      <View style={styles.illustrationWrap}>
        <WelcomeVisual />
      </View>
      <Card>
        <View style={styles.actions}>
          <Button
            testID="welcome-signup"
            label={t('auth.signUpButton')}
            icon={UserPlus}
            onPress={() => navigation.navigate('Signup')}
          />
          <Button
            testID="welcome-login"
            label={t('auth.signInButton')}
            icon={LogIn}
            variant="outline"
            onPress={() => navigation.navigate('Login')}
          />
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  logoWrap: {
    alignItems: 'center',
    marginTop: spacing.xxxl,
    marginBottom: spacing.xl,
  },
  tagline: {
    ...typography.display,
    color: colors.primaryDark,
    textAlign: 'center',
  },
  message: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.xxl,
    maxWidth: 300,
    alignSelf: 'center',
  },
  illustrationWrap: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  actions: {
    paddingVertical: spacing.xs,
    gap: spacing.md,
  },
});

export default WelcomeScreen;