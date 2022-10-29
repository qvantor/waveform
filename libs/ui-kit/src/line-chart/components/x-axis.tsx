import React from 'react';
import { theme } from '../../common/constants';
import { useLineChartContext } from '../hooks';

interface Props {
  ticks?: number;
  style?: React.CSSProperties;
  formatText?: (value: number) => string | number;
}

export const XAxis = ({ ticks, style, formatText }: Props) => {
  const { scaleX, height, padding } = useLineChartContext();
  return (
    <g>
      {scaleX.ticks(ticks).map((x) => (
        <g transform={`translate(${scaleX(x)},0)`} key={x}>
          <line
            style={{ stroke: theme.colors.primaryDarkMediumContrast, ...style }}
            y1={0}
            y2={height - padding[1] * 2}
          />
          {formatText && (
            <text y={height - padding[1] - 8} x={-10} style={{ fill: theme.colors.white, fontSize: 8 }}>
              {formatText(x)}
            </text>
          )}
        </g>
      ))}
    </g>
  );
};
