import React from 'react';
import styled from 'styled-components';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { GlobalStyle, theme } from '@waveform/ui-kit';
import { AppProvider, useApp } from './modules';
import { urlSnapshotPlugin } from './plugins/snapshot';

export { AppProvider, useApp, urlSnapshotPlugin };

const queryClient = new QueryClient();

const Root = styled.div`
  background: ${theme.colors.primary};
  height: 100vh;
  display: grid;
  grid-template-rows: 80px 1fr;
`;

export const App = ({ children }: React.PropsWithChildren) => {
  return (
    <QueryClientProvider client={queryClient}>
      <AppProvider initial={{}}>
        <GlobalStyle />
        <Root>{children}</Root>
        <Toaster />
      </AppProvider>
    </QueryClientProvider>
  );
};
