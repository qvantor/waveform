import React from 'react';
import { EditFilled } from '@ant-design/icons';
import styled from 'styled-components';
import { theme, Modal, Deactivated } from '@waveform/ui-kit';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import WaveTableEditor from '../../../wave-table-editor';
import { useOscillatorContext } from '../../hooks';
import { OscillatorStatus } from '../oscillator-status';
import { Chart } from './chart';
import { WaveInfo } from './wave-info';

// the wave and under it its frame, Phase and Phase rand: one dark block
const Root = styled.div`
  flex: 1 1;
  display: flex;
  flex-direction: column;
  background: ${theme.colors.primaryDark};
  border-radius: 3px;
`;

// the overlays (off, status, edit) cover the wave only, the values under it stay usable
const ChartArea = styled.div`
  flex: 1 1;
  position: relative;
`;

const EditIcon = styled(EditFilled)`
  position: absolute;
  top: 5px;
  left: 5px;
  z-index: 1;
  color: ${theme.colors.primaryDarkHighContrast};
  padding: 5px;
  border: 1px solid ${theme.colors.primaryDarkMediumContrast};
  border-radius: 3px;
  font-size: 10px;
  transition: all 150ms;

  &:hover {
    color: ${theme.colors.secondAccent};
    border: 1px solid ${theme.colors.secondAccent};
  }
`;

export const Wave = () => {
  const [{ $active }] = useOscillatorContext();
  const [editorOpen, setEditorOpen] = React.useState(false);
  // Phase and Phase rand held under the wave (both at once with two fingers): the chart shows them
  const [phaseHeld, setPhaseHeld] = React.useState(0);
  const toggleEditorOpen = () => setEditorOpen(!editorOpen);
  const active = useBehaviorSubject($active);
  return (
    <Root>
      <ChartArea>
        {!active && <Deactivated />}
        <OscillatorStatus />
        <EditIcon onClick={toggleEditorOpen} />
        {editorOpen ? (
          <Modal onClose={toggleEditorOpen} name='Oscillator wavetable edit'>
            <WaveTableEditor />
          </Modal>
        ) : (
          <Chart phaseVisible={phaseHeld > 0} />
        )}
      </ChartArea>
      <WaveInfo onPhaseActiveChange={(active) => setPhaseHeld((held) => held + (active ? 1 : -1))} />
    </Root>
  );
};
