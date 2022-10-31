import React from 'react';
import styled from 'styled-components';
import { theme } from '@waveform/ui-kit';

const Root = styled.div`
  border-bottom: 1px solid ${theme.colors.primaryLowContrast};
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

export const Header = ({ children }: React.PropsWithChildren) => {
  return (
    <Root>
      <Name>WAVEFORM</Name>
      {children}
    </Root>
  );
};
