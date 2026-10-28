import React from 'react';
import styled from 'styled-components';
import cls from 'classnames';
import { theme } from '@waveform/ui-kit';
import { Oscillator1, Oscillator2 } from '../synth/components';
import { EnvelopeSection, VelocitySection } from '../envelope';
import { LfoSection } from '../lfo';
import { FilterSection } from '../filter';
import { VoicingSection } from '../voicing';

// column: portrait phone, grid: landscape phone (and the portrait mini view), row: landscape mini view; the order
// of the desktop: the oscillators and the filter, then ENV, the LFOs, VELO and the voicing
export type SectionsLayout = 'column' | 'grid' | 'row';

const Root = styled.div`
  display: grid;
  gap: 1px;
  background: ${theme.colors.primaryLowContrast};

  &.column {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: 280px 280px 230px 230px 260px 200px 200px;
    grid-template-areas: 'osc1' 'osc2' 'filter' 'env' 'lfo' 'velo' 'voicing';
  }

  &.grid {
    /* the oscillators half each, then the filter and ENV, the LFOs half */
    grid-template-columns: minmax(0, 7fr) minmax(0, 5fr) minmax(0, 7fr) minmax(0, 5fr);
    grid-template-rows: 270px 230px 230px;
    grid-template-areas:
      'osc1 osc1 osc2 osc2'
      'filter filter env env'
      'lfo lfo velo voicing';
  }

  &.row {
    grid-template-columns: 3fr 3fr 3fr 3fr 3fr 1.5fr 2fr;
    grid-template-rows: 270px;
    grid-template-areas: 'osc1 osc2 filter env lfo velo voicing';
  }
`;

const Cell = styled.div`
  display: grid;
  min-width: 0;
`;

const sections: [string, React.ComponentType][] = [
  ['osc1', Oscillator1],
  ['osc2', Oscillator2],
  ['filter', FilterSection],
  ['env', EnvelopeSection],
  ['lfo', LfoSection],
  ['velo', VelocitySection],
  ['voicing', VoicingSection],
];

export const SynthSections = ({ layout }: { layout: SectionsLayout }) => (
  <Root className={cls(layout)}>
    {sections.map(([area, Component]) => (
      <Cell key={area} style={{ gridArea: area }}>
        <Component />
      </Cell>
    ))}
  </Root>
);
