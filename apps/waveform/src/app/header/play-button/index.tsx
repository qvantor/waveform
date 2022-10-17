import React from 'react';
import { CaretRightOutlined, PauseOutlined } from '@ant-design/icons';
import styled from 'styled-components';
import { theme } from '@waveform/ui-kit';
import { useBehaviorSubject } from '@waveform/rxjs';
import { useAppContext } from '../../app';

const Button = styled.button`
  border: none;
  background: ${theme.colors.primaryLowContrast};
  cursor: pointer;
  height: 80px;
  width: 80px;
  transition: all 150ms;
  background-image: linear-gradient(120deg, ${theme.colors.secondAccent}, ${theme.colors.accent} 100%);
  color: ${theme.colors.white};

  &:hover {
    filter: brightness(1.05);
  }

  &:active {
    filter: hue-rotate(10deg);
  }

  &:focus-visible {
    filter: brightness(1.05);
    outline: none;
  }
`;

export const PlayButton = () => {
  const { $play } = useAppContext().context;
  const play = useBehaviorSubject($play);
  const playToggle = () => $play.next(!play);

  return (
    <Button onClick={playToggle}>
      {play ? <PauseOutlined style={{ fontSize: 24 }} /> : <CaretRightOutlined style={{ fontSize: 24 }} />}
    </Button>
  );
};
