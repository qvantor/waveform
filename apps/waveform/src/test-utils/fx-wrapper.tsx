import React from 'react';
import { BehaviorSubject } from 'rxjs';
import { render } from '@testing-library/react';
import { AppProvider } from '../app/app';
import {
  ModulationProvider,
  SynthCoreProvider,
  useModulation,
  useSynthCore,
} from '../app/synth/common/modules';
import type { SynthModule } from '../app/synth/common/modules/synth';
import { FxProvider, useFx } from '../app/synth/fx/modules';

type FxModule = ReturnType<typeof useFx>;

const Capture = ({ onModel }: { onModel: (module: FxModule) => void }) => {
  onModel(useFx());
  return null;
};

// no note played: the fx knobs are at their values
const synth = [{ $fxNote: new BehaviorSubject(null) }, {}] as unknown as SynthModule;

const Fx = ({ children }: React.PropsWithChildren) => (
  <FxProvider initial={{}} synthCore={useSynthCore()} synth={synth} modulation={useModulation()}>
    {children}
  </FxProvider>
);

// renders the ui inside the providers the fx components need, returns the fx model to drive it
export const renderWithFx = (ui: React.ReactElement) => {
  let fx: FxModule | undefined;
  const result = render(
    <AppProvider initial={{}}>
      <SynthCoreProvider initial={undefined}>
        <ModulationProvider initial={undefined}>
          <Fx>
            <Capture onModel={(module) => (fx = module)} />
            {ui}
          </Fx>
        </ModulationProvider>
      </SynthCoreProvider>
    </AppProvider>
  );
  if (!fx) throw new Error('fx model is not initialized');
  return { ...result, fx };
};
