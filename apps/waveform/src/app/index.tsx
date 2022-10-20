import React from 'react';
import { GlobalStyle } from '@waveform/ui-kit';
import { App } from './app';
import { WaveEditor } from './wave-editor';
import { OutputWave } from './output-wave';
import { Header } from './header';
import { AudiofileWave } from './audiofile-wave';
import { WaveTableEditor } from './wave-table-editor';

export function Core() {
  return (
    <App>
      <GlobalStyle />
      {/*<Header />*/}
      {/*<AudiofileWave />*/}
      {/*<WaveEditor />*/}
      {/*<OutputWave />*/}
      <WaveTableEditor />
    </App>
  );
}

export default Core;
