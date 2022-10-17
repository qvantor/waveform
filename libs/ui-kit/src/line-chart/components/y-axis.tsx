import React from 'react';
import { line } from 'd3-shape';
import { theme } from '@waveform/ui-kit';
import { useLineChartContext } from '../hooks';

interface Props {
  ticks?: number;
  style?: React.CSSProperties;
}

export const YAxis = ({ ticks, style }: Props) => {
  const { scaleY, width, padding } = useLineChartContext();
  return (
    <g>
      {scaleY.ticks(ticks).map((y) => (
        <line
          transform={`translate(0,${scaleY(y)})`}
          style={{ stroke: theme.colors.primaryDarkMediumContrast, ...style }}
          x1={0}
          x2={width - padding[0] * 2}
          key={y}
        />
      ))}
    </g>
  );
};
