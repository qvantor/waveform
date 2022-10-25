import React from 'react';
import { WaveTableProvider, useWaveTable, WaveTableModel } from './modules';
import { WaveEditor } from '../wave-editor';
import { WaveUpscale } from '../wave-upscale';
import { WaveSelector } from './components/wave-selector';

export const WaveTable = () => {
  return (
    <WaveTableProvider initial={{}}>
      <WaveSelector />
      <WaveEditor />
      <WaveUpscale />
    </WaveTableProvider>
  );
};

export { useWaveTable };
export type { WaveTableModel };
