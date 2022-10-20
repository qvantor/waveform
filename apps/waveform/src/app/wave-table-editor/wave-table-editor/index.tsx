import React from 'react';
import { useModule } from '@waveform/rxjs';
import {
  AudioProcessorContext,
  useAudioProcessorContext,
  audioProcessorModule,
  AudioProcessorModule,
} from './modules';
import { Header } from '../header';
import { WaveTable } from '../wave-table';

export { useAudioProcessorContext, AudioProcessorModule };

export const WaveTableEditor = () => {
  const AudioProcessorModule = useModule(audioProcessorModule, []);
  return (
    <AudioProcessorContext.Provider value={AudioProcessorModule}>
      <Header />
      <WaveTable />
    </AudioProcessorContext.Provider>
  );
};
