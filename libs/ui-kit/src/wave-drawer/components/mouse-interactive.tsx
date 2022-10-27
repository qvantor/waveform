import React from 'react';
import { Vector2D } from '@waveform/math';
import { useLineChartContext, useChartMousePosition } from '../../line-chart';
import { theme } from '../../common/constants';

interface Props {
  mouse: Vector2D | null;
  setMouse: React.Dispatch<React.SetStateAction<Vector2D | null>>;
  precision: number;
}

export const MouseInteractive = ({ mouse, setMouse, precision }: Props) => {
  const { scaleX, scaleY, padding, height, width } = useLineChartContext();
  useChartMousePosition(setMouse, [1, precision]);

  return mouse ? (
    <g>
      <line
        transform={`translate(${scaleX(mouse[0])},0)`}
        stroke={theme.colors.primaryDarkHighContrast}
        y1={0}
        y2={height - padding[1] * 2}
      />
      <line
        transform={`translate(0,${scaleY(mouse[1])})`}
        style={{ stroke: theme.colors.primaryDarkHighContrast }}
        x1={0}
        x2={width - padding[0] * 2}
      />
    </g>
  ) : null;
};
