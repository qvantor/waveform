import React from 'react';
import { useLineChartContext } from '../../line-chart';
import { theme } from '@waveform/ui-kit';
import { vector2d, Vector2D } from '@waveform/math';
import { line } from 'd3-shape';

interface Props {
  mouse: Vector2D | null;
  setMouse: React.Dispatch<React.SetStateAction<Vector2D | null>>;
  precision: number;
}

export const MouseInteractive = ({ mouse, setMouse, precision }: Props) => {
  const { ref, scaleX, scaleY, padding, height, width } = useLineChartContext();

  React.useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!ref.current) return;
      const { x: xOffset, y: yOffset } = ref.current.getBoundingClientRect();
      const x = Math.round(scaleX.invert(e.clientX - xOffset - padding[0]));
      const y = Math.round(scaleY.invert(e.clientY - yOffset - padding[1]) * precision) / precision;
      if (mouse?.[0] !== x || mouse?.[1] !== y) setMouse(vector2d.fromValues(x, y));
    };
    ref.current?.addEventListener('mousemove', onMouseMove);

    return () => {
      ref.current?.removeEventListener('mousemove', onMouseMove);
    };
  }, [scaleX, scaleX, precision, padding]);

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
