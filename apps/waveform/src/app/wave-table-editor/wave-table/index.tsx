import React from 'react';
import { useBehaviorSubject, useObservable } from '@waveform/rxjs-react';
import { WaveTableProvider, useWaveTable, WaveTableModel } from './modules';
import { WaveEditor } from '../wave-editor';
import { WaveUpscale } from '../wave-upscale';

const WaveTableInternal = () => {
  const [{ $wave, $current, $rate, rateRange }, { updateCurrentWave, setCurrent, setRate }] = useWaveTable();
  const wave = useObservable($wave, []);
  const rate = useBehaviorSubject($rate);
  return (
    <>
      <button onClick={() => setCurrent($current.value === 1 ? 0 : 1)}>click</button>
      <WaveEditor
        wave={wave}
        rateRange={rateRange}
        onChange={updateCurrentWave}
        rate={rate}
        setRate={setRate}
      />
      <WaveUpscale />
    </>
  );
};

export const WaveTable = () => {
  return (
    <WaveTableProvider initial={{}}>
      <WaveTableInternal />
    </WaveTableProvider>
  );
};

export { useWaveTable };
export type { WaveTableModel };
