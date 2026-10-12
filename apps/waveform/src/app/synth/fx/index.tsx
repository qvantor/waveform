import React from 'react';
import styled from 'styled-components';
import { theme } from '@waveform/ui-kit';

const Root = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${theme.colors.primary};
  color: ${theme.colors.primaryMediumContrast};
  font-size: 36px;
  font-weight: 700;
  letter-spacing: 4px;
`;

export const FxScreen = ({ className }: { className?: string }) => <Root className={className}>FX</Root>;
