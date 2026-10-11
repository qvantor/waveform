import styled from 'styled-components';
import { MidiInput } from './components';

const Root = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

export const Settings = () => {
  return (
    <Root>
      <MidiInput />
    </Root>
  );
};
