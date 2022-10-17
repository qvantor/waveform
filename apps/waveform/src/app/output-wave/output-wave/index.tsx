import React from 'react';
import { Line, LineChart, theme, XAxis, YAxis } from '@waveform/ui-kit';
import { useBehaviorSubject } from '@waveform/rxjs';
import { useAppContext } from '../../app';
import { Controls } from './controls';

export const OutputWave = () => {
  const {
    context: { $outputWave },
  } = useAppContext();
  const outputWave = useBehaviorSubject($outputWave);
  return (
    <>
      <Controls />
      <LineChart domainY={[2, -2]} domainX={[0, outputWave[1].length - 1]}>
        <XAxis />
        <YAxis />
        <Line data={outputWave[0]} />
        <Line data={outputWave[1]} style={{ stroke: theme.colors.secondAccent, opacity: 0.7 }} />
      </LineChart>
    </>
  );
};
