import React from 'react';
import { App } from './app';
// import WaveTableEditor from './wave-table-editor';
import Synth from './synth';

export function Core() {
  return (
    <App>
      <div />
      <Synth />
      {/*<WaveTableEditor />*/}
    </App>
  );
}

export default Core;
