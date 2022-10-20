import React from 'react';
import { useBehaviorSubject, useModule, useObservable } from '@waveform/rxjs';
import { WaveTableContext, useWaveTableModule, waveTableModule, WaveTableModule } from './modules';
import { WaveEditor } from '../wave-editor';
import { WaveUpscale } from '../wave-upscale';

export { useWaveTableModule, WaveTableModule };

const WaveTableInternal = () => {
  const {
    context: { $wave, $current, $rate, rateRange },
    actions: { updateCurrentWave, setCurrent, setRate },
  } = useWaveTableModule();
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
  const WaveTableModule = useModule(waveTableModule, []);
  return (
    <WaveTableContext.Provider value={WaveTableModule}>
      <WaveTableInternal />
    </WaveTableContext.Provider>
  );
};
