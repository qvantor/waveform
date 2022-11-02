import React from 'react';
import { ManualWavetableProvider } from './modules';
import { ManualWavetable } from './components';
import { useOscillatorContext } from '../../oscillator';

export default () => {
  const oscillator = useOscillatorContext();
  return (
    <ManualWavetableProvider initial={{}} oscillator={oscillator}>
      <ManualWavetable />
    </ManualWavetableProvider>
  );
};
