import { LFOS } from '@waveform/preset-schema';
import type { LfoModule } from '../common/modules/lfos';
import type { ModulationModule } from '../common/modules/modulation';
import type { SynthModule } from '../common/modules/synth';
import { createNoteLfos, NoteLfos } from '../fx/effects/fx-modulation';
import { lfoKnobRoutes } from '../fx/modules/fx';

// the LFOs of the last note on the main thread (the marks of the knobs, the dot of the chart of an LFO), one per
// synth: on the LFOs of the lfo model, from the start of the last note ($fxNote), their knobs moved by the routes of
// the note to them
const cache = new WeakMap<object, NoteLfos>();

export const noteLfosOf = (
  sampleRate: number,
  [{ globals }]: LfoModule,
  [{ $fxNote }]: SynthModule,
  [{ $routes }]: ModulationModule
) => {
  const known = cache.get($fxNote);
  if (known) return known;
  const lfos = createNoteLfos(
    sampleRate,
    LFOS.map((id) => globals[id])
  );
  // (the models live as long as the synth: so do these)
  $fxNote.subscribe((note) => lfos.follow(note));
  $routes.subscribe((routes) => lfos.setRoutes(lfoKnobRoutes(routes)));
  cache.set($fxNote, lfos);
  return lfos;
};
