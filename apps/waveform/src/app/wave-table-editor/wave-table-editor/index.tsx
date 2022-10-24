import React from 'react';
import { AudioProcessorProvider, useAudioProcessor, AudioProcessorModel } from './modules';
import { Header } from '../header';
import { WaveTable } from '../wave-table';

export const WaveTableEditor = () => {
  return (
    <AudioProcessorProvider initial={{}}>
      <Header />
      <WaveTable />
    </AudioProcessorProvider>
  );
};
export { useAudioProcessor };
export type { AudioProcessorModel };
