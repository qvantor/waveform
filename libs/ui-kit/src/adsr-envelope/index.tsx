import React from 'react';
import styled from 'styled-components';
import { line } from 'd3-shape';
import { number, Vector2D, vector2d } from '@waveform/math';
import { LineChart, useLineChartContext, Line, XAxis, YAxis } from '../line-chart';
import { Handle } from '../handle';
import { theme } from '../common/constants';
import { text12 } from '../common/styles';

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

const CustomLine = ({ attack, hold, decay, sustain, release }: LineProps) => {
  const { scaleX, scaleY } = useLineChartContext();
  const customLineFn = line<Vector2D>()
    .x((d) => scaleX(d[0]))
    .y((d) => scaleY(d[1]));

  const data = [
    vector2d.fromValues(0, 0),
    vector2d.fromValues(attack, 1),
    vector2d.fromValues(attack + hold, 1),
    vector2d.fromValues(attack + hold + decay, sustain),
    vector2d.fromValues(attack + hold + decay + release, 0),
  ];

  const dotSize = 4;
  return (
    <>
      <Line
        customLineFn={customLineFn}
        data={data}
        style={{ strokeWidth: 1, fill: theme.colors.accent, fillOpacity: 0.1 }}
      />
      {data.map((value, index) => (
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
  onChange: (key: keyof LineProps, value: number) => void;
  // seconds of a stage at most
  maxTime: number;
};

// the chart scales to the whole envelope; the time knobs are nonlinear (pow): short times get most of their
// travel
export const AdsrEnvelope = ({ onChange, maxTime, ...rest }: Props) => {
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
      <Chart domainX={[0, Math.max(length * 1.1, 0.5)]} domainY={[1, 0]} padding={[10, 5]}>
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
