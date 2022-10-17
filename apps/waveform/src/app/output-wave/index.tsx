import React from 'react';
import styled from 'styled-components';
import { LineChart, Line, XAxis, YAxis, theme, Handle } from '@waveform/ui-kit';
import { useAppContext } from '../app';
import { useBehaviorSubject } from '@waveform/rxjs';
import { number } from '@waveform/math';
import { Analyser } from './analyser';

const Root = styled.div`
  flex: 1 1;
  display: grid;
  grid-template-columns: 50px 1fr 1fr;
  gap: 10px;
`;

export const OutputWave = () => {
  const {
    context: { $outputWave, $outputRate, $rate },
  } = useAppContext();
  const rate = useBehaviorSubject($rate);
  const outputRate = useBehaviorSubject($outputRate);
  const outputWave = useBehaviorSubject($outputWave);
  return (
    <Root>
      <div>
        <Handle
          min={rate}
          max={14}
          value={outputRate}
          onChange={(value) => $outputRate.next(value)}
          formatValue={(value) => <>Output: {number.powerOfTwo(value)}</>}
        />
      </div>
      <LineChart domainY={[2, -2]} domainX={[0, outputWave[1].length - 1]}>
        <XAxis />
        <YAxis />
        <Line data={outputWave[0]} />
        <Line data={outputWave[1]} style={{ stroke: theme.colors.secondAccent, opacity: 0.7 }} />
      </LineChart>
      <Analyser />
    </Root>
  );
};
