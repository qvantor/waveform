import React from 'react';
import { EditFilled } from '@ant-design/icons';
import styled from 'styled-components';
import { theme, Modal } from '@waveform/ui-kit';
import WaveTableEditor from '../../wave-table-editor';

const Root = styled.div`
  background: ${theme.colors.primaryDark};
  margin: 10px 10px 0 10px;
`;

export const Wave = () => {
  const [editorOpen, setEditorOpen] = React.useState(false);
  const toggleEditorOpen = () => setEditorOpen(!editorOpen);
  return (
    <Root>
      <EditFilled onClick={toggleEditorOpen} color={theme.colors.primaryHighContrast} />
      {editorOpen && (
        <Modal onClose={toggleEditorOpen} name='Oscillator wavetable edit'>
          <WaveTableEditor />
        </Modal>
      )}
    </Root>
  );
};
