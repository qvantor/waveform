import React from 'react';
import { styled } from 'styled-components';
import { number, vector2d } from '@chisper/math';
import { LineChart, useLineChartContext, Line, XAxis, YAxis } from '../line-chart';
import { Handle, knobGeometry } from '../handle';
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

// a control right of Release (the switch of the units of its times): as large as the knob with its arc (its knobs
// take no routes: a knob of size m, its label 15 px under it), level with it, 5 px from the arc
const KNOB = knobGeometry('m');
const KNOB_LABEL = 15;
const Aside = styled.div`
  align-self: flex-end;
  display: flex;
  width: ${KNOB.arc}px;
  height: ${KNOB.arc}px;
  margin: 0 0 ${KNOB_LABEL + (KNOB.box - KNOB.arc) / 2}px -9px;
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

type TimeStage = 'attack' | 'hold' | 'decay' | 'release';
// the time knobs in steps of their own (the divisions of a tempo) instead of seconds; the chart draws the seconds
// of the props
export interface AdsrSteps {
  // the values a time knob steps through, from the shortest
  steps: number[];
  // the value of each one
  values: Record<TimeStage, number>;
  format: (value: number) => string;
  // the values of the menus
  defaults?: Record<TimeStage, number>;
  onChange: (stage: TimeStage, value: number) => void;
}

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
  // the time knobs in steps (a tempo)
  timeSteps?: AdsrSteps;
  // right of Release, as large as its knob (the switch of the units of the times)
  aside?: React.ReactNode;
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
  timeSteps,
  aside,
  ...rest
}: Props) => {
  const { attack, hold, decay, sustain, release } = rest;
  const onChangeInternal = (key: keyof LineProps) => (value: number) =>
    onChange(key, number.round(value, TIME_PRECISION));
  // a time knob: by its travel (short times get most of it), or in its steps
  const timeKnob = (stage: TimeStage) =>
    timeSteps
      ? {
          min: 0,
          max: Math.max(...timeSteps.steps),
          step: timeSteps.steps,
          precision: 1,
          plotSize: 200,
          value: timeSteps.values[stage],
          formatValue: timeSteps.format,
          defaultValue: timeSteps.defaults?.[stage],
          onChange: (value: number) => timeSteps.onChange(stage, value),
        }
      : {
          min: 0,
          max: maxTime,
          mode: 'pow' as const,
          precision: TIME_PRECISION,
          plotSize: 200,
          value: rest[stage],
          formatValue: formatTime,
          defaultValue: defaultValues?.[stage],
          onChange: onChangeInternal(stage),
        };
  const timeValue = (stage: TimeStage) =>
    timeSteps ? timeSteps.format(timeSteps.values[stage]) : formatTime(rest[stage]);
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
            <HandleValue>{timeValue('attack')}</HandleValue>
            <Handle label='Attack' name='Attack time' {...timeKnob('attack')} />
          </div>
          <div>
            <HandleValue>{timeValue('hold')}</HandleValue>
            <Handle label='Hold' name='Hold time' {...timeKnob('hold')} />
          </div>
        </HandlersGroup>

        <HandlersGroup>
          <div>
            <HandleValue>{timeValue('decay')}</HandleValue>
            <Handle label='Decay' name='Decay time' {...timeKnob('decay')} />
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

        <HandlersGroup>
          <div>
            <HandleValue>{timeValue('release')}</HandleValue>
            <Handle label='Release' name='Release time' {...timeKnob('release')} />
          </div>
          {aside && <Aside>{aside}</Aside>}
        </HandlersGroup>
      </Handlers>
    </Root>
  );
};
