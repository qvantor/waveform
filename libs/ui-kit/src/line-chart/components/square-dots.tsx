import React from 'react';
import { theme } from '@waveform/ui-kit';
import { useLineChartContext } from '../hooks';

interface Props {
  data: number[];
  size?: number;
  style?: React.CSSProperties;
}

export const SquareDots = ({ data, size = 4, style }: Props) => {
  const { scaleX, scaleY } = useLineChartContext();
  return (
    <g>
      {data.map((value, index) => (
        <rect
          key={index}
          style={{ fill: theme.colors.accent, ...style }}
          x={scaleX(index) - size / 2}
          y={scaleY(value) - size / 2}
          width={size}
          height={size}
        />
      ))}
    </g>
  );
};
