import React from 'react';
import styled from 'styled-components';
import { theme } from '@waveform/ui-kit';

const Root = styled.div`
  margin-top: 40px;
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

const ExamplesText = styled.h3`
  font-weight: 600;
  color: ${theme.colors.primaryHighContrast};
`;

const ButtonContainer = styled.div`
  display: flex;
  gap: 20px;
`;

const Button = styled.button`
  font-weight: 100;
  cursor: pointer;
  padding: 15px 30px;
  border: none;
  color: ${theme.colors.primaryDarkMediumContrast};
  border-radius: 10px;
  box-shadow: 5px 5px 10px #d2d6d6, -5px -5px 10px ${theme.colors.white};
  transition: all 150ms;

  &:hover {
    box-shadow: 8px 8px 11px #dbdfe0, -8px -8px 11px #fdffff;
  }

  &:active {
    background: linear-gradient(145deg, #d4d8d9, #fdffff);
  }
`;

interface Props {
  onLoad: (buffer: ArrayBuffer) => Promise<void>;
}

const exampleFile = async (name: string): Promise<ArrayBuffer> => {
  const data = await fetch(`/assets/examples/${name}`);
  return data.arrayBuffer();
};

export const Examples = ({ onLoad }: Props) => {
  const onExampleClick = (name: string) => async () => {
    const buffer = await exampleFile(name);
    await onLoad(buffer);
  };
  return (
    <Root>
      <ExamplesText>Or select an example:</ExamplesText>
      <ButtonContainer>
        <Button onClick={onExampleClick('square.mp3')}>Square Wave</Button>
        <Button onClick={onExampleClick('kick.ogg')}>707 Kick</Button>
        <Button onClick={onExampleClick('bass.wav')}>Bass sound</Button>
      </ButtonContainer>
    </Root>
  );
};
