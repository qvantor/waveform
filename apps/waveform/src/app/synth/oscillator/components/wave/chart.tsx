import React from 'react';
import styled from 'styled-components';
import { LineChart, Line, theme } from '@waveform/ui-kit';
import { useObservable } from '@waveform/rxjs-react';
import { useOscillatorContext } from '../../hooks';
import { PhaseOverlay } from './phase-overlay';
import { periodLine, periodX } from './period';

// the top of the block of the wave, its values under it
const Root = styled(LineChart)`
  border-radius: 3px 3px 0 0;
`;

interface Props {
  // Phase or Phase rand is dragged: show them over the wave
  phaseVisible?: boolean;
}

// the wave the position plays: between two frames their morph
export const Chart = ({ phaseVisible = false }: Props) => {
  const [{ $morphWave }] = useOscillatorContext();
  const wave = useObservable($morphWave, []);
  const line = React.useMemo(() => periodLine(wave), [wave]);
  return (
    <Root padding={[-1, 2]} domainX={[periodX(0, wave.length), periodX(1, wave.length)]} domainY={[1, -1]}>
      <Line data={line} style={{ fill: theme.colors.accent, fillOpacity: 0.3 }} />
      <PhaseOverlay wave={wave} line={line} visible={phaseVisible} />
    </Root>
  );
};
