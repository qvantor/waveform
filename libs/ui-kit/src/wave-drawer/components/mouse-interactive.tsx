import React from 'react';
import { Vector2D, vector2d, number } from '@waveform/math';
import { scaleLinear } from 'd3-scale';
import { theme } from '../../common/constants';
import { useLineChartContext, XAxis } from '../../line-chart';

interface Props {
  mouse: Vector2D | null;
  setMouse: React.Dispatch<React.SetStateAction<Vector2D | null>>;
  precisionY: number;
  customDomainX: [number, number];
}

export const MouseInteractive = ({ mouse, setMouse, precisionY, customDomainX }: Props) => {
  const { ref, scaleX, scaleY, padding, width } = useLineChartContext();
  const customScaleX = React.useMemo(
    () => scaleLinear([0, width - padding[0] * 2]).domain(customDomainX),
    [customDomainX, width, padding]
  );
  const tickWidth = customScaleX(1) - customScaleX(0);
  React.useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!ref.current) return;
      const { x: xOffset, y: yOffset } = ref.current.getBoundingClientRect();
      const x = number.thresholds(
        Math.round(customScaleX.invert(e.clientX - tickWidth / 2 - xOffset - padding[0])),
        customDomainX[0],
        customDomainX[1] - 1
      );
      const y = Math.round(scaleY.invert(e.clientY - yOffset - padding[1]) * precisionY) / precisionY;
      if (mouse?.[0] !== x || mouse?.[1] !== y) setMouse(vector2d.fromValues(x, y));
    };
    ref.current?.addEventListener('mousemove', onMouseMove);

    return () => {
      ref.current?.removeEventListener('mousemove', onMouseMove);
    };
  }, [ref, scaleX, scaleY, precisionY, padding, mouse, setMouse, customScaleX, customDomainX, tickWidth]);

  return (
    <g>
      <XAxis ticks={customDomainX[1]} customScaleX={customScaleX} />
      {mouse && (
        <rect
          width={tickWidth}
          height={1}
          fill={theme.colors.secondAccent}
          transform={`translate(${customScaleX(mouse[0])},${scaleY(mouse[1]) - 0.5})`}
        />
      )}
    </g>
  );
};
