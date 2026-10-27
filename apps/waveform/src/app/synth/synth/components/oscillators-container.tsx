import React from 'react';
import { Section } from '@waveform/ui-kit';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { Oscillator } from '../../oscillator';
import { useOscillator1, useOscillator2 } from '../../common/modules';

interface OscillatorComponentParams {
  useOscillator: typeof useOscillator1;
  name: string;
  // the prefix of its modulation targets
  target: 'osc1' | 'osc2';
}

const OscillatorComponentFactory =
  ({ useOscillator, name, target }: OscillatorComponentParams) =>
  () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [model, actions] = useOscillator();
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const active = useBehaviorSubject(model.$active);
    return (
      <Section name={name} active={active} onClick={actions.toggleActive}>
        <Oscillator {...model} {...actions} useOscillator={useOscillator} target={target} />
      </Section>
    );
  };

export const Oscillator1 = OscillatorComponentFactory({
  name: 'Osc 1',
  useOscillator: useOscillator1,
  target: 'osc1',
});
export const Oscillator2 = OscillatorComponentFactory({
  name: 'Osc 2',
  useOscillator: useOscillator2,
  target: 'osc2',
});
