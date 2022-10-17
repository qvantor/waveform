import React from 'react';
import styled from 'styled-components';
import { useBehaviorSubject } from '@waveform/rxjs';
import { theme, Handle } from '@waveform/ui-kit';
import { useAppContext } from '../app';
import { PlayButton } from './play-button';

const Root = styled.div`
  border-bottom: 1px solid ${theme.colors.primaryLowContrast};
  margin: -20px -20px 0 -20px;
  padding: 0 20px;
  display: flex;
  gap: 20px;
  justify-content: space-between;
`;

const Name = styled.h1`
  color: ${theme.colors.secondAccent};
  font-size: 36px;
  line-height: 40px;
  font-weight: 700;
  background: -webkit-linear-gradient(45deg, ${theme.colors.secondAccent}, ${theme.colors.accent} 80%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  padding: 20px 20px 20px 0;
  margin: 0;
  border-right: 1px solid ${theme.colors.primaryLowContrast};
  user-select: none;
`;

const Container = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 20px;
`;

export const Header = () => {
  const { $frequency } = useAppContext().context;
  const frequency = useBehaviorSubject($frequency);
  return (
    <Root>
      <Name>WAVE EDITOR</Name>
      <Container>
        <Handle
          min={20}
          max={4000}
          step={10}
          value={frequency}
          onChange={(value) => $frequency.next(value)}
          label='Freq'
        />
        <PlayButton />
      </Container>
    </Root>
  );
};
