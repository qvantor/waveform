import React from 'react';
import styled from 'styled-components';
import { theme } from '@waveform/ui-kit';
import { AppModelProvider } from './modules';
export { appSnapshotPlugin } from './plugins/snapshot';

const Root = styled.div`
  background: ${theme.colors.primary};
  height: 100vh;
  display: grid;
  grid-template-rows: 80px 1fr;
`;

export const App = ({ children }: React.PropsWithChildren) => {
  return (
    <AppModelProvider initial={{}}>
      <Root>{children}</Root>
    </AppModelProvider>
  );
};
