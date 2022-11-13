import React from 'react';
import styled from 'styled-components';
import { Toaster } from 'react-hot-toast';
import { GlobalStyle, theme } from '@waveform/ui-kit';
import { AppProvider, useApp } from './modules';
import { appSnapshotPlugin } from './plugins/snapshot';

export { AppProvider, useApp, appSnapshotPlugin };

const Root = styled.div`
  background: ${theme.colors.primary};
  height: 100vh;
  display: grid;
  grid-template-rows: 80px 1fr;
`;

export const App = ({ children }: React.PropsWithChildren) => {
  return (
    <AppProvider initial={{}}>
      <GlobalStyle />
      <Root>{children}</Root>
      <Toaster />
    </AppProvider>
  );
};
