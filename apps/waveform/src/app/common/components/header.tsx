import React from 'react';
import styled from 'styled-components';
import { theme } from '@waveform/ui-kit';

const Root = styled.div`
  border-bottom: 1px solid ${theme.colors.primaryLowContrast};
  padding: 0 10px;
  display: flex;
  align-items: center;
  gap: 20px;
  justify-content: space-between;
`;

const Logo = styled.a`
  text-decoration: none;
  border-right: 1px solid ${theme.colors.primaryLowContrast};
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding-right: 20px;
`;

const Name = styled.h1`
  color: ${theme.colors.secondAccent};
  font-size: 36px;
  font-weight: 700;
  background: -webkit-linear-gradient(45deg, ${theme.colors.secondAccent}, ${theme.colors.accent} 80%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  margin: 0;
`;

const Small = styled.small`
  display: block;
  font-size: 12px;
  text-align: right;
  color: ${theme.colors.primaryDarkMediumContrast};
  font-weight: bold;
  margin-top: -6px;
`;

export const Header = ({ children }: React.PropsWithChildren) => {
  return (
    <Root>
      <Logo href='https://github.com/qvantor/waveform' target='_blank' referrerPolicy='no-referrer'>
        <Name>WAVEFORM</Name>
        <Small>by Qvantor</Small>
      </Logo>
      {children}
    </Root>
  );
};
