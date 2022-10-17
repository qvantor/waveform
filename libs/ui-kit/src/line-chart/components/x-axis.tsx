import React from 'react';
import { theme } from '../../common/constants';
import { useLineChartContext } from '../hooks';

interface Props {
  ticks?: number;
  style?: React.CSSProperties;
}

export const XAxis = ({ ticks, style }: Props) => {
  const { scaleX, height, padding } = useLineChartContext();
  return (
    <g>
      {scaleX.ticks(ticks).map((x) => (
        <line
          transform={`translate(${scaleX(x)},0)`}
          style={{ stroke: theme.colors.primaryDarkMediumContrast, ...style }}
          y1={0}
          y2={height - padding[1] * 2}
          key={x}
        />
      ))}
    </g>
  );
};
