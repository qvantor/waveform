import { Observable } from 'rxjs';
import { LFOS } from '@waveform/preset-schema';
import type { LfoModule } from '../common/modules/lfos';
import type { ModRoute } from '../common/modules/modulation';
import { lfoKnobRoutes } from '../common/modulation/modulation-targets';
import { createNoteLfos, FxNote, NoteLfos } from '../fx/effects/fx-modulation';

// the LFOs of the last note on the main thread (the marks of the knobs, the dot of the chart of an LFO): on the
// LFOs of the lfo model, from the start of the last note ($fxNote), their knobs moved by the routes of the note to
// them. The synth model holds them: they follow it and the routes while it lives (its subscriptions)
export const noteLfosOf = (
  sampleRate: number,
  [{ globals }]: LfoModule,
  $fxNote: Observable<FxNote | null>,
  $routes: Observable<ModRoute[]>
) => {
  const lfos: NoteLfos = createNoteLfos(
    sampleRate,
    LFOS.map((id) => globals[id])
  );
  const follow = () => [
    $fxNote.subscribe((note) => lfos.follow(note)),
    $routes.subscribe((routes) => lfos.setRoutes(lfoKnobRoutes(routes))),
  ];
  return { lfos, follow };
};
