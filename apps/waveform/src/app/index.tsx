import React from 'react';
import { GlobalStyle } from '@waveform/ui-kit';
import { App } from './app';
import { WaveEditor } from './wave-editor';
import { OutputWave } from './output-wave';
import { Header } from './header';

export function Core() {
  return (
    <App>
      <GlobalStyle />
      <Header />
      <WaveEditor />
      <OutputWave />
    </App>
  );
}

export default Core;
