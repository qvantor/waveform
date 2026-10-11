import React from 'react';
import styled from 'styled-components';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { GlobalStyle, theme, useIsMobile } from '@waveform/ui-kit';
import { AppProvider, useApp } from './modules';
import { urlSnapshotPlugin, getSnapshot, applySnapshot, $snapshotChanges } from './plugins/snapshot';

export { AppProvider, useApp, urlSnapshotPlugin, getSnapshot, applySnapshot, $snapshotChanges };

const queryClient = new QueryClient();

const Root = styled.div`
  background: ${theme.colors.primary};
  height: 100vh;
  display: grid;
  grid-template-rows: 80px 1fr;

  &.mobile {
    height: 100dvh;
    grid-template-rows: auto minmax(0, 1fr);
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom)
      env(safe-area-inset-left);
    box-sizing: border-box;
    overflow: hidden;
  }
`;

export const App = ({ children }: React.PropsWithChildren) => {
  const isMobile = useIsMobile();
  return (
    <QueryClientProvider client={queryClient}>
      <AppProvider initial={{}}>
        <GlobalStyle />
        <Root className={isMobile ? 'mobile' : undefined}>{children}</Root>
        <Toaster />
      </AppProvider>
    </QueryClientProvider>
  );
};
