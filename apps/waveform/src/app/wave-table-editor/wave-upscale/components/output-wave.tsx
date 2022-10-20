import React from 'react';
import { Line, LineChart, theme, XAxis, YAxis } from '@waveform/ui-kit';
import { useWaveUpscale } from '../modules';
import { useBehaviorSubject } from '@waveform/rxjs';

export const OutputWave = () => {
  const {
    context: { $outputWave },
  } = useWaveUpscale();
  const outputWave = useBehaviorSubject($outputWave);
  return (
    <>
      <LineChart domainY={[2, -2]} domainX={[0, outputWave[1].length - 1]}>
        <XAxis />
        <YAxis />
        <Line data={outputWave[0]} />
        <Line data={outputWave[1]} style={{ stroke: theme.colors.secondAccent, opacity: 0.7 }} />
      </LineChart>
    </>
  );
};
