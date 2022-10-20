import React from 'react';
import styled from 'styled-components';
import { useModule } from '@waveform/rxjs';
import { waveUpscaleModule, WaveUpscaleContext } from './modules';
import { useWaveTableModule } from '../wave-table';
import { Controls, OutputWave } from './components';
import { useAudioProcessorContext } from '../wave-table-editor';

const Root = styled.div`
  display: grid;
  grid-template-columns: 50px 1fr;
  gap: 20px;
`;

export const WaveUpscale = () => {
  const WaveTableModule = useWaveTableModule();
  const AudioProcessorModule = useAudioProcessorContext();
  const WaveUpscaleModule = useModule(waveUpscaleModule, [WaveTableModule, AudioProcessorModule]);
  return (
    <WaveUpscaleContext.Provider value={WaveUpscaleModule}>
      <Root>
        <Controls />
        <OutputWave />
      </Root>
    </WaveUpscaleContext.Provider>
  );
};
