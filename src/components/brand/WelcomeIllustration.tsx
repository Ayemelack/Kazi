import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from '../../theme';

function WelcomeIllustration() {
  return (
    <Svg width={220} height={170} viewBox="0 0 220 170">
      <Rect
        x={8}
        y={6}
        width={204}
        height={158}
        rx={24}
        fill={colors.primarySoft}
      />
      <Circle cx={186} cy={26} r={6} fill={colors.accent} />
      <Rect
        x={56}
        y={24}
        width={108}
        height={122}
        rx={16}
        fill={colors.surface}
      />
      <Circle cx={68} cy={40} r={3.5} fill={colors.accent} />
      <Rect
        x={78}
        y={36.5}
        width={46}
        height={7}
        rx={3.5}
        fill={colors.surfaceAlt}
      />

      <Rect x={68} y={58} width={14} height={14} rx={4} fill={colors.success} />
      <Rect
        x={88}
        y={62.5}
        width={40}
        height={5}
        rx={2.5}
        fill={colors.border}
      />
      <Rect
        x={136}
        y={62.5}
        width={26}
        height={5}
        rx={2.5}
        fill={colors.success}
      />
      <Path
        d="M71 67 L75 63 M71 63 L75 63 M75 63 L75 67"
        stroke="#FFFFFF"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />

      <Rect x={68} y={79} width={14} height={14} rx={4} fill={colors.error} />
      <Rect
        x={88}
        y={83.5}
        width={40}
        height={5}
        rx={2.5}
        fill={colors.border}
      />
      <Rect
        x={136}
        y={83.5}
        width={18}
        height={5}
        rx={2.5}
        fill={colors.error}
      />
      <Path
        d="M75 62 L71 66 M75 66 L71 66 M71 66 L71 62"
        stroke="#FFFFFF"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />

      <Rect
        x={68}
        y={100}
        width={14}
        height={14}
        rx={4}
        fill={colors.primary}
      />
      <Rect
        x={88}
        y={104.5}
        width={40}
        height={5}
        rx={2.5}
        fill={colors.border}
      />
      <Rect
        x={136}
        y={104.5}
        width={24}
        height={5}
        rx={2.5}
        fill={colors.primary}
      />
      <Rect x={71} y={103} width={8} height={8} rx={1.5} fill="#FFFFFF" />

      <Rect
        x={68}
        y={121}
        width={14}
        height={14}
        rx={4}
        fill={colors.warning}
      />
      <Rect
        x={88}
        y={125.5}
        width={40}
        height={5}
        rx={2.5}
        fill={colors.border}
      />
      <Rect
        x={136}
        y={125.5}
        width={20}
        height={5}
        rx={2.5}
        fill={colors.warning}
      />
      <Circle
        cx={75}
        cy={128}
        r={4.5}
        stroke="#FFFFFF"
        strokeWidth={1.5}
        fill="none"
      />
    </Svg>
  );
}

export default React.memo(WelcomeIllustration);