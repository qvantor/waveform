import React from 'react';
import styled from 'styled-components';
import { LineChart, Line, theme } from '@waveform/ui-kit';
import { useBehaviorSubject, useObservable } from '@waveform/rxjs-react';
import { useOscillatorContext } from '../../hooks';
import { PhaseOverlay } from './phase-overlay';

// the top of the block of the wave, its values under it
const Root = styled(LineChart)`
  border-radius: 3px 3px 0 0;
`;

// one period from edge to edge (phase 0 to 360°): the first sample again at its end; the zeros outside the
// chart close the fill along the middle
const periodLine = (wave: number[]) => (wave.length ? [0, ...wave, wave[0], 0] : []);

interface Props {
  // Phase or Phase rand is dragged: show them over the wave
  phaseVisible?: boolean;
}

// the wave the position plays: between two frames their morph
export const Chart = ({ phaseVisible = false }: Props) => {
  const [{ $morphWave, $osc }] = useOscillatorContext();
  const wave = useObservable($morphWave, []);
  const { phase, phaseRand } = useBehaviorSubject($osc);
  const data = React.useMemo(() => periodLine(wave), [wave]);
  return (
    <Root padding={[-1, 2]} domainX={[1, wave.length + 1]} domainY={[1, -1]}>
      <Line data={data} style={{ fill: theme.colors.accent, fillOpacity: 0.3 }} />
      <PhaseOverlay wave={wave} data={data} phase={phase} phaseRand={phaseRand} visible={phaseVisible} />
    </Root>
  );
};
