import React from 'react';
import { ManualWavetableProvider } from './modules';
import { ManualWavetable } from './components';
import { useOscillator } from '../../common/modules';

export default () => {
  const oscillator = useOscillator();
  return (
    <ManualWavetableProvider initial={{}} oscillator={oscillator}>
      <ManualWavetable />
    </ManualWavetableProvider>
  );
};
