import React from 'react';
import { Vector2D, number, vector2d } from '@waveform/math';
import { LineChart, YAxis, Line, SquareDots, XAxis } from '../line-chart';
import { MouseInteractive } from './components';
import { theme } from '../common/constants';

interface Props {
  wave: number[];
  onChange?: (value: [number, number]) => void;
  rate?: number;
  precision?: number;
  range?: [number, number];
}

// @todo improve performance
export const WaveDrawer = ({ rate = 4, precision = 10, wave, range = [2, 7], onChange }: Props) => {
  const { rateInternal, dotSize, domainX, domainY } = React.useMemo(() => {
    const dotSize = 6;
    const rateInternal = number.thresholds(rate, ...range);
    const domainX = vector2d.fromValues(0, number.powerOfTwo(rateInternal) - 1);
    const domainY = vector2d.fromValues(1, -1);
    return { rateInternal, dotSize, domainX, domainY };
  }, [rate, range]);

  const [mouse, setMouse] = React.useState<Vector2D | null>(null);
  const [isMouseDown, setIsMouseDown] = React.useState(false);
  const croppedWave = React.useMemo(
    () => [...wave].splice(0, number.powerOfTwo(rateInternal)),
    [wave, rateInternal]
  );
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
      <XAxis ticks={domainX[1]} />
      <YAxis ticks={precision * 2} />
      {onChange && <MouseInteractive mouse={mouse} setMouse={setMouse} precision={precision} />}
      <Line data={croppedWave} style={{ fill: theme.colors.accent, fillOpacity: 0.2 }} />
      <SquareDots data={croppedWave} size={dotSize} />
    </LineChart>
  );
};
