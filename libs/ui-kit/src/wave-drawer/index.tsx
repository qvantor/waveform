import React from 'react';
import { Vector2D, number, vector2d } from '@waveform/math';
import { LineChart, YAxis, Line } from '../line-chart';
import { MouseInteractive } from './components';
import { theme } from '../common/constants';

interface Props {
  wave: number[];
  onChange?: (value: [number, number]) => void;
  rate?: number;
  precisionY?: number;
}

// @todo improve performance
export const WaveDrawer = ({ rate = 4, precisionY = 10, wave, onChange }: Props) => {
  const { domainX, domainY } = React.useMemo(() => {
    const domainX = vector2d.fromValues(0, wave.length-1);
    const domainY = vector2d.fromValues(1, -1);
    return { domainX, domainY };
  }, [wave.length]);

  const [mouse, setMouse] = React.useState<Vector2D | null>(null);
  const [isMouseDown, setIsMouseDown] = React.useState(false);

  const updateWave = React.useCallback((mouseValue: Vector2D) => onChange?.(mouseValue), [onChange]);
  const onMouseDown = React.useCallback(() => {
    if (!mouse) return;
    updateWave(mouse);
    setIsMouseDown(true);
  }, [updateWave, mouse]);
  const onMouseLeave = React.useCallback(() => {
    setMouse(null);
    setIsMouseDown(false);
  }, []);

  React.useEffect(() => {
    if (!mouse || !isMouseDown) return;
    updateWave(mouse);
  }, [mouse, isMouseDown, updateWave]);

  return (
    <LineChart
      onMouseDown={onMouseDown}
      onMouseLeave={onMouseLeave}
      onMouseUp={onMouseLeave}
      domainX={domainX}
      domainY={domainY}
    >
      <YAxis ticks={precisionY * 2} />
      {onChange && (
        <MouseInteractive
          mouse={mouse}
          setMouse={setMouse}
          precisionY={precisionY}
          customDomainX={[0, number.powerOfTwo(rate)]}
        />
      )}
      <Line data={wave} style={{ fill: theme.colors.accent, fillOpacity: 0.2 }} />
    </LineChart>
  );
};
