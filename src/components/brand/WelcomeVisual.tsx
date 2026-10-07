import React, { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { colors } from '../../theme';
import WelcomeIllustration from './WelcomeIllustration';

const FRAME_WIDTH = 220;
const FRAME_HEIGHT = 170;
const CORNER_RADIUS = 24;

function WelcomeVisual() {
  const [hasLoadError, setHasLoadError] = useState(false);

  if (hasLoadError) {
    return <WelcomeIllustration />;
  }

  return (
    <View style={styles.frame}>
      <Image
        source={require('../../../assets/welcome/shopkeeper-business-loop.webp')}
        resizeMode="cover"
        accessible={false}
        onError={() => setHasLoadError(true)}
        style={styles.photo}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: FRAME_WIDTH,
    height: FRAME_HEIGHT,
    borderRadius: CORNER_RADIUS,
    overflow: 'hidden',
    backgroundColor: colors.surfaceAlt,
  },
  photo: {
    width: '100%',
    height: '100%',
  },
});

export default React.memo(WelcomeVisual);

