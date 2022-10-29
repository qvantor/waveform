import React from 'react';
import styled from 'styled-components';
import { line } from 'd3-shape';
import { Vector2D, vector2d } from '@waveform/math';
import { LineChart, useLineChartContext, Line, XAxis, YAxis } from '../line-chart';
import { Handle } from '../handle';
import { theme } from '../common/constants';
import { text12 } from '../common/styles';

const Root = styled.div``;

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
      <Line customLineFn={customLineFn} data={data} style={{ strokeWidth: 1 }} />
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

type Props = LineProps & {
  onChange: (key: keyof LineProps, value: number) => void;
};

export const AdsrEnvelope = ({ onChange, ...rest }: Props) => {
  const { attack, hold, decay, sustain, release } = rest;
  const formatValue = (value: number) => `${value * 1000}ms`;
  const handleProps = {
    min: 0,
    max: 1,
    step: 0.001,
    rotateSpeed: 3,
    formatValue,
  };
  const onChangeInternal = (key: keyof LineProps) => (value: number) =>
    onChange(key, Math.round(value * 1000) / 1000);

  return (
    <Root>
      <LineChart
        style={{ height: 150 }}
        domainX={[0, Math.max(attack + hold + decay + release + 0.1, 0.5)]}
        domainY={[1, 0]}
        padding={[10, 5]}
      >
        <YAxis ticks={2} />
        <XAxis ticks={4} formatText={(value) => `${value * 1000}ms`} />
        <CustomLine {...rest} />
      </LineChart>
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
              step={0.01}
              value={sustain}
              onChange={onChangeInternal('sustain')}
              formatValue={(value) => Math.round(value * 100)}
            />
          </div>
        </HandlersGroup>

        <div>
          <HandleValue>{formatValue(release )}</HandleValue>
          <Handle label='Release' {...handleProps} value={release} onChange={onChangeInternal('release')} />
        </div>
      </Handlers>
    </Root>
  );
};
