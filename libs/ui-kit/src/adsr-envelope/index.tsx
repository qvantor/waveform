import React from 'react';
import styled from 'styled-components';
import { line } from 'd3-shape';
import { number, Vector2D, vector2d } from '@waveform/math';
import { LineChart, useLineChartContext, Line, XAxis, YAxis } from '../line-chart';
import { Handle } from '../handle';
import { theme } from '../common/constants';
import { text12 } from '../common/styles';

export { NoteDot } from './note-dot';
export type { NotePath } from './note-dot';

const Root = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
`;

const Chart = styled(LineChart)`
  flex: 1 1;
  border-radius: 3px;
`;

const Handlers = styled.div`
  display: flex;
  justify-content: space-between;
`;

const HandlersGroup = styled.div`
  display: flex;
  gap: 10px;
`;

const HandleValue = styled.p`
  ${text12};
  text-align: center;
  margin-top: 7px;
`;

interface LineProps {
  attack: number;
  hold: number;
  decay: number;
  sustain: number;
  release: number;
}

// the curvature of the attack, the decay and the release: k of (1 - e^(-k·x)) / (1 - e^(-k)) over the share x of
// the stage, 0 a line (the envelope-curve.ts of the app)
export interface AdsrCurves {
  attack: number;
  decay: number;
  release: number;
}
const curveShape = (k: number, x: number) => (k === 0 ? x : (1 - Math.exp(-k * x)) / (1 - Math.exp(-k)));
// the points of a curved stage (a line has its corners alone)
export const CURVE_POINTS = 32;

// the line of an envelope from its corners: a curved stage from one to the next in CURVE_POINTS points
export const envelopeLine = (
  { attack, hold, decay, sustain, release }: LineProps,
  curves: AdsrCurves = { attack: 0, decay: 0, release: 0 }
) => {
  const corners: [number, number][] = [
    [0, 0],
    [attack, 1],
    [attack + hold, 1],
    [attack + hold + decay, sustain],
    [attack + hold + decay + release, 0],
  ];
  const ks = [curves.attack, 0, curves.decay, curves.release];
  const points: [number, number][] = [corners[0]];
  ks.forEach((k, stage) => {
    const [[x0, y0], [x1, y1]] = [corners[stage], corners[stage + 1]];
    if (k !== 0)
      for (let i = 1; i < CURVE_POINTS; i++)
        points.push([x0 + ((x1 - x0) * i) / CURVE_POINTS, y0 + (y1 - y0) * curveShape(k, i / CURVE_POINTS)]);
    points.push(corners[stage + 1]);
  });
  return { corners, points };
};

const CustomLine = ({ curves, ...stages }: LineProps & { curves?: AdsrCurves }) => {
  const { scaleX, scaleY } = useLineChartContext();
  const customLineFn = line<Vector2D>()
    .x((d) => scaleX(d[0]))
    .y((d) => scaleY(d[1]));

  const { corners, points } = envelopeLine(stages, curves);
  const data = points.map(([x, y]) => vector2d.fromValues(x, y));

  const dotSize = 4;
  return (
    <>
      <Line
        customLineFn={customLineFn}
        data={data}
        style={{ strokeWidth: 1, fill: theme.colors.accent, fillOpacity: 0.1 }}
      />
      {corners.map((value, index) => (
        <rect
          key={index}
          style={{ fill: theme.colors.accent }}
          x={scaleX(value[0]) - dotSize / 2}
          y={scaleY(value[1]) - dotSize / 2}
          width={dotSize}
          height={dotSize}
        />
      ))}
    </>
  );
};

// 0.5ms, 12ms, 340ms, 1.25s, 12.5s
export const formatTime = (seconds: number) => {
  if (seconds < 0.01) return `${number.round(seconds * 1000, 10)}ms`;
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  if (seconds < 10) return `${number.round(seconds, 100)}s`;
  return `${number.round(seconds, 10)}s`;
};

// the times in steps of 0.1 ms
const TIME_PRECISION = 10000;

type Props = LineProps & {
  // the shape of the stages (none: lines)
  curves?: AdsrCurves;
  onChange: (key: keyof LineProps, value: number) => void;
  // seconds of a stage at most
  maxTime: number;
  // HTML over the chart, in its context (the NoteDot of a playing note)
  children?: React.ReactNode;
};

// the chart scales to the whole envelope; the time knobs are nonlinear (pow): short times get most of their
// travel
export const AdsrEnvelope = ({ onChange, maxTime, children, ...rest }: Props) => {
  const { attack, hold, decay, sustain, release } = rest;
  const formatValue = formatTime;
  const handleProps = {
    min: 0,
    max: maxTime,
    mode: 'pow' as const,
    precision: TIME_PRECISION,
    plotSize: 200,
    formatValue,
  };
  const onChangeInternal = (key: keyof LineProps) => (value: number) =>
    onChange(key, number.round(value, TIME_PRECISION));
  const length = attack + hold + decay + release;

  return (
    <Root>
      <Chart domainX={[0, Math.max(length * 1.1, 0.5)]} domainY={[1, 0]} padding={[10, 5]} overlay={children}>
        <YAxis ticks={2} />
        <XAxis ticks={4} formatText={formatTime} />
        <CustomLine {...rest} />
      </Chart>
      <Handlers>
        <HandlersGroup>
          <div>
            <HandleValue>{formatValue(attack)}</HandleValue>
            <Handle label='Attack' {...handleProps} value={attack} onChange={onChangeInternal('attack')} />
          </div>
          <div>
            <HandleValue>{formatValue(hold)}</HandleValue>
            <Handle label='Hold' {...handleProps} value={hold} onChange={onChangeInternal('hold')} />
          </div>
        </HandlersGroup>

        <HandlersGroup>
          <div>
            <HandleValue>{formatValue(decay)}</HandleValue>
            <Handle label='Decay' {...handleProps} value={decay} onChange={onChangeInternal('decay')} />
          </div>
          <div>
            <HandleValue>{Math.round(sustain * 100)}</HandleValue>
            <Handle
              label='Sustain'
              min={0}
              max={1}
              value={sustain}
              onChange={onChangeInternal('sustain')}
              formatValue={(value) => Math.round(value * 100)}
            />
          </div>
        </HandlersGroup>

        <div>
          <HandleValue>{formatValue(release)}</HandleValue>
          <Handle label='Release' {...handleProps} value={release} onChange={onChangeInternal('release')} />
        </div>
      </Handlers>
    </Root>
  );
};
