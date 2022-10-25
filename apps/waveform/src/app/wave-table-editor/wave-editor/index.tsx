import React from 'react';
import { useBehaviorSubject, useObservable } from '@waveform/rxjs-react';
import { useWaveTable } from '../wave-table';
import { WaveEditor as WaveEditorInternal } from './components/wave-editor';

export const WaveEditor = () => {
  const [{ $wave, $rate, rateRange }, { updateCurrentWave, setRate }] = useWaveTable();
  const wave = useObservable($wave, []);
  const rate = useBehaviorSubject($rate);
  return (
    <WaveEditorInternal
      wave={wave}
      rateRange={rateRange}
      onChange={updateCurrentWave}
      rate={rate}
      setRate={setRate}
    />
  );
};
