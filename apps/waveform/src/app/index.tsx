import React from 'react';
import { GlobalStyle } from '@waveform/ui-kit';
import { App } from './app';
import WaveTableEditor from './wave-table-editor';

export function Core() {
  return (
    <App>
      <GlobalStyle />
      <WaveTableEditor />
    </App>
  );
}

export default Core;
