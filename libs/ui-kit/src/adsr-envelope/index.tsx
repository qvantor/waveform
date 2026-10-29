import React from 'react';
import styled from 'styled-components';
import { number, vector2d } from '@waveform/math';
import { LineChart, useLineChartContext, Line, XAxis, YAxis } from '../line-chart';
import { Handle } from '../handle';
import { theme } from '../common/constants';
import { text12 } from '../common/styles';
import { AdsrCurves, envelopeLine, LineProps } from './envelope-line';
import { CurveHandles, CurveStage } from './curve-handles';

export { NoteDot, NOTE_DOT_COLOR, NOTE_DOT_RADIUS } from './note-dot';
export { VelocityCurve, VelocityDot } from './velocity-curve';
export { CurvePoint, POINT_HIT_RADIUS, POINT_RADIUS } from './curve-handles';
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

const CustomLine = ({ curves, ...stages }: LineProps & { curves?: AdsrCurves }) => {
  const { scaleX, scaleY } = useLineChartContext();
  const { corners, points } = envelopeLine(stages, curves);
  const data = points.map(([x, y]) => vector2d.fromValues(x, y));

  const dotSize = 4;
  return (
    <>
      <Line data={data} style={{ strokeWidth: 1, fill: theme.colors.accent, fillOpacity: 0.1 }} />
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
  // the curves are dragged on the chart (none without it): a point in the middle of each stage longer than
  // CURVE_HANDLE_MIN_TIME that moves the level
  onCurveChange?: (stage: CurveStage, k: number) => void;
  // |k| of a dragged curve at most
  curveMax?: number;
  // the curves a double click on a point sets (lines without them)
  defaultCurves?: AdsrCurves;
  // the value each knob's menu sets (none without them)
  defaultValues?: LineProps;
  // HTML over the chart, in its context (the NoteDot of a playing note)
  children?: React.ReactNode;
};

// the chart scales to the whole envelope; the time knobs are nonlinear (pow): short times get most of their
// travel
export const AdsrEnvelope = ({
  onChange,
  maxTime,
  onCurveChange,
  curveMax,
  defaultCurves,
  defaultValues,
  children,
  ...rest
}: Props) => {
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
        {onCurveChange && (
          <CurveHandles {...rest} max={curveMax} defaults={defaultCurves} onChange={onCurveChange} />
        )}
      </Chart>
      <Handlers>
        <HandlersGroup>
          <div>
            <HandleValue>{formatValue(attack)}</HandleValue>
            <Handle
              label='Attack'
              name='Attack time'
              {...handleProps}
              value={attack}
              defaultValue={defaultValues?.attack}
              onChange={onChangeInternal('attack')}
            />
          </div>
          <div>
            <HandleValue>{formatValue(hold)}</HandleValue>
            <Handle
              label='Hold'
              name='Hold time'
              {...handleProps}
              value={hold}
              defaultValue={defaultValues?.hold}
              onChange={onChangeInternal('hold')}
            />
          </div>
        </HandlersGroup>

        <HandlersGroup>
          <div>
            <HandleValue>{formatValue(decay)}</HandleValue>
            <Handle
              label='Decay'
              name='Decay time'
              {...handleProps}
              value={decay}
              defaultValue={defaultValues?.decay}
              onChange={onChangeInternal('decay')}
            />
          </div>
          <div>
            <HandleValue>{Math.round(sustain * 100)}</HandleValue>
            <Handle
              label='Sustain'
              name='Sustain level'
              min={0}
              max={1}
              value={sustain}
              defaultValue={defaultValues?.sustain}
              onChange={onChangeInternal('sustain')}
              formatValue={(value) => Math.round(value * 100)}
            />
          </div>
        </HandlersGroup>

        <div>
          <HandleValue>{formatValue(release)}</HandleValue>
          <Handle
            label='Release'
            name='Release time'
            {...handleProps}
            value={release}
            defaultValue={defaultValues?.release}
            onChange={onChangeInternal('release')}
          />
        </div>
      </Handlers>
    </Root>
  );
};
