import React from 'react';
import { useOscillatorContext } from '../../oscillator';
import { ManualWavetableProvider } from './modules';
import { ManualWavetable } from './components';

export default () => {
  const oscillator = useOscillatorContext();
  return (
    <ManualWavetableProvider initial={{}} oscillator={oscillator}>
      <ManualWavetable />
    </ManualWavetableProvider>
  );
};
