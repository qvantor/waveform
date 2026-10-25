import React from 'react';
import { BehaviorSubject, distinctUntilChanged, map } from 'rxjs';
import { VelocityCurve } from '@waveform/ui-kit';
import { useBehaviorSubject, useObservable } from '@waveform/rxjs-react';
import { ENVELOPE_CURVE_MAX } from '@waveform/preset-schema';
import { useEnvelopes } from '../../common/modules';
import { SynthContext } from '../../common/modules/synth';
import type { FxNote } from '../../fx/effects/fx-modulation';

// without the synth (a spec of the section) no note is played
const NO_NOTE = new BehaviorSubject<FxNote | null>(null);

// the VELO tab: the curve of the velocity (the level of VELO over the velocity of a note) with the dot of the
// last note pressed (the fx and the marks of the knobs follow it), and Amp, the share of the volume it takes.
// A note reads them when it is pressed
export const VelocitySection = () => {
  const [{ $velocity }, { setVelocity }] = useEnvelopes();
  const $fxNote = React.useContext(SynthContext)?.[0].$fxNote ?? NO_NOTE;
  const { amp, k } = useBehaviorSubject($velocity);
  const $share = React.useMemo(
    () =>
      $fxNote.pipe(
        map((note) => note?.velocity ?? null),
        distinctUntilChanged()
      ),
    [$fxNote]
  );
  const velocity = useObservable($share, $fxNote.value?.velocity ?? null);
  return (
    <VelocityCurve
      k={k}
      curveMax={ENVELOPE_CURVE_MAX}
      onCurveChange={(value) => setVelocity('k', value)}
      amp={amp}
      onAmpChange={(value) => setVelocity('amp', value)}
      velocity={velocity}
    />
  );
};
