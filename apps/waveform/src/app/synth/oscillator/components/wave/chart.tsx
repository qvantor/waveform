import React from 'react';
import { LineChart, Line } from '@waveform/ui-kit';
import { useObservable } from '@waveform/rxjs-react';
import { useOscillator } from '../../../common/modules';

export const Chart = () => {
  const [{ $wave }] = useOscillator();
  const wave = useObservable($wave, []);
  return (
    <LineChart domainX={[0, wave.length - 1]} domainY={[1, -1]}>
      <Line data={wave} />
    </LineChart>
  );
};
