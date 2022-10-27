import React from 'react';
import { vector2d, Vector2D } from '@waveform/math';
import { useLineChartContext } from './use-line-chart-context';

export const useChartMousePosition = (onMove: (value: Vector2D) => void, precision: Vector2D = [1, 1]) => {
  const { ref, scaleX, scaleY, padding } = useLineChartContext();
  const prevPosition = React.useRef<Vector2D>([0, 0]);

  React.useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!ref.current) return;
      const { x: xOffset, y: yOffset } = ref.current.getBoundingClientRect();
      const mousePosition = vector2d.fromValues(
        Math.round(scaleX.invert(e.clientX - xOffset - padding[0]) * precision[0]) / precision[0],
        Math.round(scaleY.invert(e.clientY - yOffset - padding[1]) * precision[1]) / precision[1]
      );
      const { current: prev } = prevPosition;
      if (!vector2d.isEqual(prev, mousePosition)) onMove(mousePosition);
      prevPosition.current = mousePosition;
    };
    ref.current?.addEventListener('mousemove', onMouseMove);

    return () => {
      ref.current?.removeEventListener('mousemove', onMouseMove);
    };
  }, [onMove, padding, precision, ref, scaleX, scaleY]);
};
