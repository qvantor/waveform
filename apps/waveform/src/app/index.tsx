import React from 'react';
import { GlobalStyle } from '@waveform/ui-kit';
import { App } from './app';
import { WaveEditor } from './wave-editor';
import { OutputWave } from './output-wave';

export function Core() {
  return (
    <App>
      <GlobalStyle />
      <WaveEditor />
      <OutputWave />
    </App>
  );
}

export default Core;
