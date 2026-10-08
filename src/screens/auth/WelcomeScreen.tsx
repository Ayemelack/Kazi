import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
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
import Button from '../../components/ui/Button';
import KaziLogo from '../../components/brand/KaziLogo';
import WelcomeIllustration from '../../components/brand/WelcomeIllustration';
import type { AuthStackParamList } from '../../navigation/RootNavigator';
import { colors, spacing, typography } from '../../theme';

type ScreenProps = NativeStackScreenProps<AuthStackParamList, 'Welcome'>;

const HERO_MIN_HEIGHT = 240;
const HERO_MAX_HEIGHT = 420;
const HERO_SCREEN_RATIO = 0.4;

const IMG_W = 575;
const IMG_H = 1280;
const CROP_TOP = 56;
const FADE_END = 570;
const WINDOW_H = FADE_END - CROP_TOP;

const CHIP_PATCH = { x: 153, y: 448, w: 54, h: 27 };
const CHIP_LABEL = '+2,400';
const CHIP_BG = '#FCFBF7';
const CHIP_FONT_BASE = 15;
const BOB_DISTANCE = 4;
const BOB_DURATION = 1200;

function WelcomeScreen({ navigation }: ScreenProps) {
  const { t } = useTranslation();
  const { height, width } = useWindowDimensions();
  const [hasLoadError, setHasLoadError] = useState(false);
  const bob = useRef(new Animated.Value(0)).current;

  const heroHeight = Math.min(
    Math.max(Math.round(height * HERO_SCREEN_RATIO), HERO_MIN_HEIGHT),
    HERO_MAX_HEIGHT,
  );

  const scale = Math.max(width / IMG_W, heroHeight / WINDOW_H);
  const displayW = IMG_W * scale;
  const displayH = IMG_H * scale;
  const imageLeft = Math.min(0, (width - displayW) / 2);
  const imageTop = -CROP_TOP * scale;

  const chipLeft = CHIP_PATCH.x * scale + imageLeft;
  const chipTop = (CHIP_PATCH.y - CROP_TOP) * scale;
  const chipWidth = CHIP_PATCH.w * scale;
  const chipHeight = CHIP_PATCH.h * scale;
  const chipFontSize = Math.max(8, Math.round(CHIP_FONT_BASE * scale));

  useEffect(() => {
    let running = false;
    let reduceMotion = false;

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, {
          toValue: -BOB_DISTANCE,
          duration: BOB_DURATION,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(bob, {
          toValue: 0,
          duration: BOB_DURATION,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );

    const start = () => {
      if (!running && !reduceMotion) {
        running = true;
        loop.start();
      }
    };
    const stop = () => {
      running = false;
      loop.stop();
      bob.setValue(0);
    };

    AccessibilityInfo.isReduceMotionEnabled()
      .then(enabled => {
        reduceMotion = enabled;
        if (enabled) {
          stop();
        }
      })
      .catch(() => {});

    const unsubFocus = navigation.addListener('focus', start);
    const unsubBlur = navigation.addListener('blur', stop);
    start();

    return () => {
      stop();
      unsubFocus();
      unsubBlur();
    };
  }, [navigation, bob]);

  return (
    <Screen scroll>
      <View style={[styles.hero, { height: heroHeight, width }]}>
        {hasLoadError ? (
          <View style={styles.heroFallback}>
            <WelcomeIllustration />
          </View>
        ) : (
          <>
            <Image
              source={require('../../../Welcome screen image.jpeg')}
              accessible={false}
              onError={() => setHasLoadError(true)}
              style={[styles.heroImage, {
                width: displayW,
                height: displayH,
                left: imageLeft,
                top: imageTop,
              }]}
            />
            <Animated.View
              pointerEvents="none"
              accessible={false}
              style={[
                styles.chip,
                {
                  left: chipLeft,
                  top: chipTop,
                  width: chipWidth,
                  height: chipHeight,
                  transform: [{ translateY: bob }],
                },
              ]}>
              <Text style={[styles.chipText, { fontSize: chipFontSize }]} numberOfLines={1}>
                {CHIP_LABEL}
              </Text>
            </Animated.View>
          </>
        )}
        <Svg style={styles.heroFadeLayer}>
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
          style={styles.signInButton}
          onPress={() => navigation.navigate('Login')}
        />
      </View>
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
  },
  heroFadeLayer: {
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
  chip: {
    position: 'absolute',
    backgroundColor: CHIP_BG,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: {
    color: colors.primary,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: -0.2,
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
    marginBottom: spacing.huge,
    maxWidth: 300,
    alignSelf: 'center',
  },
  actions: {
    paddingVertical: spacing.xs,
    gap: spacing.xl,
  },
  signInButton: {
    backgroundColor: colors.background,
  },
});

export default WelcomeScreen;
