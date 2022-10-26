import React from 'react';
import { ManualWavetableProvider, useManualWavetable } from './modules';
import { WaveSelector, WaveEditor } from '../common/components';
import { WaveUpscale } from './wave-upscale';
import styled from 'styled-components';

const ManualRoot = styled.div`
  display: grid;
  grid-template-rows: 46px 1fr 1fr;
  gap: 20px;
  padding: 20px 20px 20px 0;
`;

const WaveSelectorInternal = () => {
  const [{ rateRange, ...model }, { setCurrent, cloneCurrent }] = useManualWavetable();
  return <WaveSelector {...model} setCurrent={setCurrent} cloneCurrent={cloneCurrent} />;
};

const WaveEditorInternal = () => {
  const [{ $waveTable, $current, ...model }, { setRate, updateCurrentWave }] = useManualWavetable();
  return <WaveEditor {...model} setRate={setRate} updateCurrentWave={updateCurrentWave} />;
};

export const ManualWavetable = () => {
  return (
    <ManualWavetableProvider initial={{}}>
      <ManualRoot>
        <WaveSelectorInternal />
        <WaveEditorInternal />
        <WaveUpscale />
      </ManualRoot>
    </ManualWavetableProvider>
  );
};
