import React from 'react';
import styled from 'styled-components';
import { theme } from '@waveform/ui-kit';
// import { useModule } from '@waveform/rxjs';
// import { AppContext } from './constants';
// import { appModule } from './modules';
import { AppModelProvider } from './modules/app-module';

export { appSnapshotPlugin } from './plugins/snapshot';
export { useAppContext } from './hooks';

const Root = styled.div`
  background: ${theme.colors.primary};
  height: calc(100vh - 40px);
  display: grid;
  grid-template-rows: 60px 1fr 1fr 1fr;
  gap: 20px;
  padding: 20px;
`;

export const App = ({ children }: React.PropsWithChildren) => {
  // const module = useModule(appModule, []);
  return (
    <AppModelProvider initial={{}}>
      {/*<AppContext.Provider value={module}>*/}
      <Root>{children}</Root>
      {/*</AppContext.Provider>*/}
    </AppModelProvider>
  );
};
