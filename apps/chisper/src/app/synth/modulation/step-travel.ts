import React from 'react';
import { BehaviorSubject } from 'rxjs';
import type { ModTravel } from '@chisper/ui-kit';
import { useBehaviorSubject } from '@chisper/rxjs-react';
import { TEMPO_DEFAULT } from '@chisper/preset-schema';
import { MOD_TARGETS, ModScale } from '../common/modulation/modulation-targets';
import { TransportContext } from '../common/modules/transport';

// without the transport (a spec of a section) the tempo it starts at
const DEFAULT_TEMPO = new BehaviorSubject(TEMPO_DEFAULT);
// the tempo in effect (BPM)
export const useTempo = () =>
  useBehaviorSubject(React.useContext(TransportContext)?.[0].$tempo ?? DEFAULT_TEMPO);

// a value as a share of the scale of a route over `range` (amountInUnits): octaves of a log one, the share of the
// travel of a pow one (the cores: max · share⁴), of the range of a linear one
const routeShare = (scale: ModScale, [min, max]: [number, number]) =>
  scale === 'log'
    ? (value: number) => Math.log(value / min) / Math.log(max / min)
    : scale === 'pow'
      ? (value: number) => Math.sqrt(Math.sqrt(Math.max(0, value) / max))
      : (value: number) => (value - min) / (max - min);

// a knob of steps (divisions in BPM) whose routes move its value in the units of HZ (`scale` over `range`, as
// without steps): `values` those of its steps in the order of its travel (rising), the knob at step `index`. Its
// position as a share of the scale of the routes, and a share of it to a share of the travel: linear between the
// two steps it is between, searched from the step of the knob on (up from it, or down: of steps of one value the
// knob's own), 1 past the last one, 0 under the first
export const stepTravel = (
  values: readonly number[],
  index: number,
  scale: ModScale,
  range: [number, number]
): ModTravel => {
  const shares = values.map(routeShare(scale, range));
  const last = shares.length - 1;
  const position = shares[index];
  const travel = (share: number) => {
    if (last <= 0) return 0;
    let j = index;
    if (share >= position) {
      while (j < last && shares[j + 1] < share) j++;
      if (j === last) return 1;
      const span = shares[j + 1] - shares[j];
      return (j + (span > 0 ? (share - shares[j]) / span : 0)) / last;
    }
    while (j > 0 && shares[j - 1] > share) j--;
    if (j === 0) return 0;
    return (j - (shares[j] - share) / (shares[j] - shares[j - 1])) / last;
  };
  return { position, travel };
};

// the travel of the routes of a knob of steps (`steps`: divisions, the knob at `division`) at the tempo in effect:
// `valueOf` a division in the units of `target` at a tempo (as the cores play it); none for a target without a
// scale of its own
export const useStepTravel = (
  target: string,
  steps: readonly number[],
  division: number,
  valueOf: (division: number, bpm: number) => number
): ModTravel | undefined => {
  const bpm = useTempo();
  return React.useMemo(() => {
    const definition = MOD_TARGETS[target];
    if (definition?.kind !== 'lfo' && definition?.kind !== 'fx') return undefined;
    const index = steps.indexOf(division);
    if (index < 0) return undefined;
    return stepTravel(
      steps.map((step) => valueOf(step, bpm)),
      index,
      definition.scale,
      definition.range
    );
  }, [target, steps, division, valueOf, bpm]);
};
