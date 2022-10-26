import React from 'react';
import { Header } from './header';
import { WaveTableEditor, AudioProcessorProvider } from './wave-table-editor';

export default () => {
  return (
    <AudioProcessorProvider initial={{}}>
      <Header />
      <WaveTableEditor />
    </AudioProcessorProvider>
  );
};
