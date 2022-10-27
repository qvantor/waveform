import React from 'react';
import { ManualWavetableProvider } from './modules';
import { ManualWavetable } from './components';

export default () => (
  <ManualWavetableProvider initial={{}}>
    <ManualWavetable />
  </ManualWavetableProvider>
);
