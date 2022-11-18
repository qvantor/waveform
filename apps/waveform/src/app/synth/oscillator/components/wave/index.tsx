import React from 'react';
import { EditFilled } from '@ant-design/icons';
import styled from 'styled-components';
import { theme, Modal, Deactivated } from '@waveform/ui-kit';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import WaveTableEditor from '../../../wave-table-editor';
import { useOscillatorContext } from '../../hooks';
import { Chart } from './chart';

const Root = styled.div`
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
  const toggleEditorOpen = () => setEditorOpen(!editorOpen);
  const active = useBehaviorSubject($active);
  return (
    <Root>
      {!active && <Deactivated />}
      <EditIcon onClick={toggleEditorOpen} />
      {editorOpen ? (
        <Modal onClose={toggleEditorOpen} name='Oscillator wavetable edit'>
          <WaveTableEditor />
        </Modal>
      ) : (
        <Chart />
      )}
    </Root>
  );
};
