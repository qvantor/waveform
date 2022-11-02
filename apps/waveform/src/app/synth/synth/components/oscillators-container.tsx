import React from 'react';
import styled from 'styled-components';
import { Section, theme } from '@waveform/ui-kit';
import { Oscillator } from '../../oscillator';
import { useOscillator1, useOscillator2 } from '../../common/modules';
import { useBehaviorSubject } from '@waveform/rxjs-react';

interface OscillatorComponentParams {
  useOscillator: typeof useOscillator1;
  name: string;
}

const Root = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  background: ${theme.colors.primaryLowContrast};
  gap: 1px;
`;

const OscillatorComponentFactory =
  ({ useOscillator, name }: OscillatorComponentParams) =>
  () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [model, actions] = useOscillator();
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const active = useBehaviorSubject(model.$active);
    return (
      <Section name={name} active={active} onClick={actions.toggleActive}>
        <Oscillator {...model} {...actions} useOscillator={useOscillator} />
      </Section>
    );
  };

const Oscillator1 = OscillatorComponentFactory({ name: 'Osc 1', useOscillator: useOscillator1 });
const Oscillator2 = OscillatorComponentFactory({ name: 'Osc 2', useOscillator: useOscillator2 });

export const OscillatorsContainer = () => (
  <Root>
    <Oscillator1 />
    <Oscillator2 />
  </Root>
);
