import React from 'react';
import styled from 'styled-components';
import cls from 'classnames';
import { theme } from '@waveform/ui-kit';
import { Oscillator1, Oscillator2 } from '../synth/components';
import { EnvelopeSection } from '../envelope';
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
    grid-template-rows: 280px 280px 230px 230px 200px;
    grid-template-areas: 'osc1' 'osc2' 'env' 'filter' 'voicing';
  }

  &.grid {
    grid-template-columns: repeat(8, minmax(0, 1fr));
    grid-template-rows: 270px 230px;
    grid-template-areas:
      'osc1 osc1 osc1 osc1 osc2 osc2 osc2 osc2'
      'env env env filter filter filter voicing voicing';
  }

  &.row {
    grid-template-columns: 3fr 3fr 3fr 3fr 2fr;
    grid-template-rows: 270px;
    grid-template-areas: 'osc1 osc2 env filter voicing';
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
