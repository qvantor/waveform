import { combineLatest, Observable } from 'rxjs';
import { LFOS } from '@waveform/preset-schema';
import type { LfoModule } from '../common/modules/lfos';
import type { ModRoute } from '../common/modules/modulation';
import { lfoKnobRoutes } from '../common/modulation/modulation-targets';
import { createNoteLfos, FxNote, NoteLfos } from '../fx/effects/fx-modulation';

// the LFOs of the last note on the main thread (the marks of the knobs, the dot of the chart of an LFO): on the
// LFOs of the lfo model, from the start of the last note ($fxNote), their knobs moved by the routes of the note to
// them (within their divisions at the tempo in BPM). The synth model holds them: they follow it and the routes while it lives (its subscriptions)
export const noteLfosOf = (
  sampleRate: number,
  [{ globals, $ranges }]: LfoModule,
  $fxNote: Observable<FxNote | null>,
  $routes: Observable<ModRoute[]>
) => {
  const lfos: NoteLfos = createNoteLfos(
    sampleRate,
    LFOS.map((id) => globals[id])
  );
  const follow = () => [
    $fxNote.subscribe((note) => lfos.follow(note)),
    combineLatest([$routes, $ranges]).subscribe(([routes, ranges]) =>
      lfos.setRoutes(lfoKnobRoutes(routes, ranges))
    ),
  ];
  return { lfos, follow };
};
