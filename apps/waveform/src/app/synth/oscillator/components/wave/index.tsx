import React from 'react';
import { EditFilled } from '@ant-design/icons';
import styled from 'styled-components';
import { theme, Modal } from '@waveform/ui-kit';
import WaveTableEditor from '../../../wave-table-editor';
import { Chart } from './chart';
import { useOscillatorContext } from '../../hooks';
import { useBehaviorSubject } from '@waveform/rxjs-react';

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

const Deactivated = styled.div`
  position: absolute;
  width: 100%;
  height: 100%;
  background-image: linear-gradient(
    135deg,
    ${theme.colors.primaryDark} 25%,
    ${theme.colors.primaryDarkMediumContrast} 25%,
    ${theme.colors.primaryDarkMediumContrast} 50%,
    ${theme.colors.primaryDark} 50%,
    ${theme.colors.primaryDark} 75%,
    ${theme.colors.primaryDarkMediumContrast} 75%,
    ${theme.colors.primaryDarkMediumContrast} 100%
  );
  background-size: 10px 10px;
  opacity: 0.8;
  z-index: 1;
  border-radius: 3px;
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
