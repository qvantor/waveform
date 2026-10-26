import React from 'react';
import styled from 'styled-components';
import cls from 'classnames';
import { theme } from '@waveform/ui-kit';
import { Oscillator1, Oscillator2 } from '../synth/components';
import { EnvelopeSection, VelocitySection } from '../envelope';
import { FilterSection } from '../filter';
import { VoicingSection } from '../voicing';

// column: portrait phone, grid: landscape phone (and the portrait mini view), row: landscape mini view
export type SectionsLayout = 'column' | 'grid' | 'row';

const Root = styled.div`
  display: grid;
  gap: 1px;
  background: ${theme.colors.primaryLowContrast};

  &.column {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: 280px 280px 230px 200px 230px 200px;
    grid-template-areas: 'osc1' 'osc2' 'env' 'velo' 'filter' 'voicing';
  }

  &.grid {
    /* the oscillators half each */
    grid-template-columns: minmax(0, 8fr) minmax(0, 4fr) minmax(0, 7fr) minmax(0, 5fr);
    grid-template-rows: 270px 230px;
    grid-template-areas:
      'osc1 osc1 osc2 osc2'
      'env velo filter voicing';
  }

  &.row {
    grid-template-columns: 3fr 3fr 3fr 1.5fr 3fr 2fr;
    grid-template-rows: 270px;
    grid-template-areas: 'osc1 osc2 env velo filter voicing';
  }
`;

const Cell = styled.div`
  display: grid;
  min-width: 0;
`;

const sections: [string, React.ComponentType][] = [
  ['osc1', Oscillator1],
  ['osc2', Oscillator2],
  ['env', EnvelopeSection],
  ['velo', VelocitySection],
  ['filter', FilterSection],
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
