import React, { useState } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LogIn, UserPlus } from 'lucide-react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import Screen from '../../components/ui/Screen';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import KaziLogo from '../../components/brand/KaziLogo';
import WelcomeIllustration from '../../components/brand/WelcomeIllustration';
import type { AuthStackParamList } from '../../navigation/RootNavigator';
import { colors, spacing, typography } from '../../theme';

type ScreenProps = NativeStackScreenProps<AuthStackParamList, 'Welcome'>;

const HERO_MIN_HEIGHT = 240;
const HERO_MAX_HEIGHT = 420;
const HERO_SCREEN_RATIO = 0.4;

function WelcomeScreen({ navigation }: ScreenProps) {
  const { t } = useTranslation();
  const { height, width } = useWindowDimensions();
  const [hasLoadError, setHasLoadError] = useState(false);

  const heroHeight = Math.min(
    Math.max(Math.round(height * HERO_SCREEN_RATIO), HERO_MIN_HEIGHT),
    HERO_MAX_HEIGHT,
  );

  return (
    <Screen scroll>
      <View style={[styles.hero, { height: heroHeight, width }]}>
        {hasLoadError ? (
          <View style={styles.heroFallback}>
            <WelcomeIllustration />
          </View>
        ) : (
          <Image
            source={require('../../../assets/welcome/shopkeeper-business-loop.webp')}
            resizeMode="cover"
            accessible={false}
            onError={() => setHasLoadError(true)}
            style={styles.heroImage}
          />
        )}
        <Svg style={styles.heroImage}>
          <Defs>
            <LinearGradient id="heroFade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={colors.background} stopOpacity="0" />
              <Stop offset="0.45" stopColor={colors.background} stopOpacity="0" />
              <Stop offset="0.72" stopColor={colors.background} stopOpacity="0.55" />
              <Stop offset="0.9" stopColor={colors.background} stopOpacity="0.92" />
              <Stop offset="1" stopColor={colors.background} stopOpacity="1" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#heroFade)" />
        </Svg>
      </View>

      <View style={styles.logoWrap}>
        <KaziLogo markSize={48} textSize={27} />
      </View>
      <Text style={styles.tagline}>{t('empty.homeMessage')}</Text>
      <Text style={styles.message}>{t('welcome.message')}</Text>
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
  hero: {
    marginHorizontal: -spacing.lg,
    marginTop: -spacing.lg,
    marginBottom: spacing.xl,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  heroImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  heroFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoWrap: {
    alignItems: 'center',
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
  actions: {
    paddingVertical: spacing.xs,
    gap: spacing.md,
  },
});

export default WelcomeScreen;
