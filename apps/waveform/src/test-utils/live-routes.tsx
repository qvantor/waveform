import React from 'react';
import { BehaviorSubject } from 'rxjs';
import { act } from '@testing-library/react';
import { ModSource } from '@waveform/preset-schema';
import { ModulationContext } from '../app/synth/common/modules/modulation';
import { SynthContext, SynthModule } from '../app/synth/common/modules/synth';
import { SynthCoreContext } from '../app/synth/common/modules/synth-core';
import type { FxNote } from '../app/synth/fx/effects/fx-modulation';
import { createModulation } from './models';

// what the routes of a knob sound in (useKnobModulation): the modulation model, the last note of the synth and its
// voices, the clock of the core. `route` adds a route, `play` a note whose envelopes stay at a level while its
// voices sound
export const createLiveRoutes = () => {
  const modulation = createModulation();
  const $fxNote = new BehaviorSubject<FxNote | null>(null);
  const $voicesCount = new BehaviorSubject(0);
  const synth = [{ $fxNote, $voicesCount }, {}] as unknown as SynthModule;
  const core = [{ audioCtx: { currentTime: 1 } }, {}] as never;
  const Wrapper = ({ children }: React.PropsWithChildren) => (
    <SynthCoreContext.Provider value={core}>
      <SynthContext.Provider value={synth}>
        <ModulationContext.Provider value={modulation}>{children}</ModulationContext.Provider>
      </SynthContext.Provider>
    </SynthCoreContext.Provider>
  );
  const route = (target: string, amount: number, source: ModSource = 'env2') =>
    act(() => modulation[1].addRoute(source, target, amount));
  const play = (level: number) =>
    act(() => {
      const flat = { attack: 0, hold: 0, decay: 0, sustain: level, release: 0 };
      $fxNote.next({ envelopes: [flat, flat, flat], start: 0, release: null });
      $voicesCount.next(1);
    });
  return { Wrapper, route, play };
};
