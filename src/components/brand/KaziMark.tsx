import React from 'react';
import Svg, { Circle, Rect } from 'react-native-svg';
import { colors } from '../../theme';

interface Props {
  size?: number;
}

function KaziMark({ size = 64 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Rect x={2} y={2} width={60} height={60} rx={18} fill={colors.primary} />
      <Rect x={18} y={44} width={26} height={7} rx={3.5} fill="#FFFFFF" />
      <Rect x={22} y={34} width={22} height={7} rx={3.5} fill="#FFFFFF" opacity={0.92} />
      <Rect x={26} y={24} width={18} height={7} rx={3.5} fill="#FFFFFF" opacity={0.84} />
      <Circle cx={46} cy={20} r={3.5} fill={colors.accent} />
    </Svg>
  );
}

export default React.memo(KaziMark);