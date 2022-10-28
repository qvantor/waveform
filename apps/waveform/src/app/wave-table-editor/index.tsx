import React from 'react';
import { Header } from './header';
import { AudioProcessorProvider } from './common/modules';
import { WaveTableEditor } from './wave-table-editor';

export default () => {
  return (
    <AudioProcessorProvider initial={{}}>
      <Header />
      <WaveTableEditor />
    </AudioProcessorProvider>
  );
};
