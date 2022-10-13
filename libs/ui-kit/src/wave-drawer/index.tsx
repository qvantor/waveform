import React from 'react';
import styled from 'styled-components';
import { scaleLinear } from 'd3-scale';
import { line } from 'd3-shape';
import { Vector2D, vector2d, number } from '@waveform/math';
import { theme } from '../common/constants';

interface Props {
  size?: number;
  height?: number;
  yPrecision?: number;
}

const Root = styled.div`
  background: ${theme.colors.primaryDark};
`;

const sizeToValue = (size: number) => 2 ** size;

export const WaveDrawer = ({ size = 4, height = 300, yPrecision = 10 }: Props) => {
  const ref = React.useRef<HTMLDivElement>(null);

  const { padding, sizeInternal, range, dotSize } = React.useMemo(() => {
    const dotSize = 4;
    const range: [number, number] = [2, 7]; // draw from 4 to 128 points
    const sizeInternal = number.thresholds(size, ...range);
    const padding = vector2d.fromValues(5, 2);
    return { padding, sizeInternal, range, dotSize };
  }, [size]);

  const [mouse, setMouse] = React.useState<Vector2D | null>(null);
  const [width, setWidth] = React.useState(400);
  const [wave, setWave] = React.useState<Array<number>>(Array(sizeToValue(range[1])).fill(0));
  const croppedWave = React.useMemo(
    () => [...wave].splice(0, sizeToValue(sizeInternal)),
    [wave, sizeInternal]
  );

  React.useLayoutEffect(() => {
    if (!ref.current) return;
    setWidth(ref.current.clientWidth);
  }, []);

  const [scaleX, scaleY, lineFn] = React.useMemo(() => {
    const scaleX = scaleLinear([0, width - padding[0] * 2]).domain([0, sizeToValue(sizeInternal) - 1]);
    const scaleY = scaleLinear([0, height - padding[1] * 2]).domain([1, -1]);
    const lineFn = line<number>()
      .x((d, i) => scaleX(i))
      .y(scaleY);

    return [scaleX, scaleY, lineFn];
  }, [sizeInternal, height, width, padding]);

  const onMouseMove = (e: React.MouseEvent) => {
    if (!ref.current) return;
    const { x: xOffset, y: yOffset } = ref.current.getBoundingClientRect();
    const x = Math.round(scaleX.invert(e.clientX - xOffset - padding[0]));
    const y = Math.round(scaleY.invert(e.clientY - yOffset - padding[1]) * yPrecision) / yPrecision;
    setMouse(vector2d.fromValues(x, y));
  };

  const onMouseLeave = () => {
    setMouse(null);
  };

  return (
    <Root onMouseMove={onMouseMove} onMouseLeave={onMouseLeave} style={{ height }} ref={ref}>
      <svg style={{ width, height }}>
        <g transform={`translate(${padding[0]}, ${padding[1]})`}>
          <g>
            {scaleY.ticks(5).map((y) => (
              <line
                transform={`translate(0,${scaleY(y)})`}
                stroke={theme.colors.primaryDarkMediumContrast}
                x1={0}
                x2={width - padding[0] * 2}
                key={y}
              />
            ))}
          </g>
          <g>
            {scaleX.ticks(sizeToValue(sizeInternal) - 1).map((x) => (
              <line
                transform={`translate(${scaleX(x)},0)`}
                stroke={
                  mouse?.[0] === x
                    ? theme.colors.primaryDarkHighContrast
                    : theme.colors.primaryDarkMediumContrast
                }
                y1={0}
                y2={height - padding[1] * 2}
                key={x}
              />
            ))}
          </g>
          <g>
            {mouse && (
              <rect
                x={scaleX(mouse[0]) - dotSize / 2}
                y={scaleY(mouse[1]) - dotSize / 2}
                fill={theme.colors.primaryDarkHighContrast}
                width={dotSize}
                height={dotSize}
              />
            )}
          </g>
          <path
            style={{ stroke: theme.colors.accent, fill: 'transparent', strokeWidth: 1 }}
            d={lineFn(croppedWave) ?? undefined}
          />
          <g>
            {croppedWave.map((value, index) => (
              <rect
                key={index}
                style={{ fill: value === 0 ? theme.colors.accent : 'yellow' }}
                x={scaleX(index) - dotSize / 2}
                y={scaleY(value) - dotSize / 2}
                width={dotSize}
                height={dotSize}
              />
            ))}
          </g>
        </g>
      </svg>
    </Root>
  );
};
