import React from 'react';
import { theme } from '../../common/constants';
import { useLineChartContext } from '../hooks';
import { ScaleLinear } from 'd3-scale';

interface Props {
  ticks?: number;
  style?: React.CSSProperties;
  formatText?: (value: number) => string | number;
  customScaleX?: ScaleLinear<number, number>;
}

export const XAxis = ({ ticks, style, formatText, customScaleX }: Props) => {
  const { scaleX, height, padding } = useLineChartContext();
  const scaleXInternal = customScaleX ?? scaleX;
  return (
    <g>
      {scaleXInternal.ticks(ticks).map((x) => (
        <g transform={`translate(${scaleXInternal(x)},0)`} key={x}>
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
