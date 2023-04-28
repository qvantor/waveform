import styled from 'styled-components';
import { IconButton } from '@waveform/ui-kit';
import { AiOutlineSave } from 'react-icons/ai';
import { useApp } from '../../app';
import { MidiInput } from './components';

const Root = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

export const Settings = () => {
  const [, { save }] = useApp();
  return (
    <Root>
      <MidiInput />
      <IconButton onClick={save}>
        <AiOutlineSave />
      </IconButton>
    </Root>
  );
};
