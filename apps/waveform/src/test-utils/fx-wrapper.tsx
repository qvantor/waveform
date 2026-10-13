import React from 'react';
import { render } from '@testing-library/react';
import { AppProvider } from '../app/app';
import { SynthCoreProvider, useSynthCore } from '../app/synth/common/modules';
import { FxProvider, useFx } from '../app/synth/fx/modules';

type FxModule = ReturnType<typeof useFx>;

const Capture = ({ onModel }: { onModel: (module: FxModule) => void }) => {
  onModel(useFx());
  return null;
};

const Fx = ({ children }: React.PropsWithChildren) => (
  <FxProvider initial={{}} synthCore={useSynthCore()}>
    {children}
  </FxProvider>
);

// renders the ui inside the providers the fx components need, returns the fx model to drive it
export const renderWithFx = (ui: React.ReactElement) => {
  let fx: FxModule | undefined;
  const result = render(
    <AppProvider initial={{}}>
      <SynthCoreProvider initial={undefined}>
        <Fx>
          <Capture onModel={(module) => (fx = module)} />
          {ui}
        </Fx>
      </SynthCoreProvider>
    </AppProvider>
  );
  if (!fx) throw new Error('fx model is not initialized');
  return { ...result, fx };
};
