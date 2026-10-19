import type { FilterNumerics } from '@waveform/ui-kit';
import { FX_TYPES, FxType } from '@waveform/preset-schema';
import { rangesOf } from '../../filter/constants';
import { FX_REGISTRY, MIX_PARAM } from '../../fx/effects';
import { OscParam } from '../wavetable/wavetable-osc-params';

// the knobs a source (ENV 1–3) can be assigned to, by id (`osc1.wave`): the drop targets of the ENV tabs and
// the keys of the routes in the preset. An amount is a share of the range of the knob in its scale: in the
// units of the param it moves that is amount × (max - min), for a log knob amount × log2(max / min) octaves

export type ModScale = 'linear' | 'log';

// a param of the voice node of each note (wavetable-osc-params.ts), moved by the envelopes of the note;
// range: of the knob, in the units of the param (the Wave knob shows frames, its param is a share of the
// table: an amount moves it by the same share whatever the table)
interface OscTarget {
  kind: 'osc';
  osc: number;
  param: OscParam;
  label: string;
  scale: ModScale;
  range: [number, number];
}

// a knob of the filter in the voice node of each note (voice-filter.ts); its scale and range are those of the
// type of the filter (filterTargetScale)
interface FilterTarget {
  kind: 'filter';
  param: FilterNumerics;
  label: string;
}

// a knob of an effect, moved by the envelopes of the last note (fx-modulation.ts): its params and its mix;
// the switches (modes, era) are not assignable
interface FxTarget {
  kind: 'fx';
  fx: FxType;
  param: string;
  label: string;
  scale: ModScale;
  range: [number, number];
}

export type ModTarget = OscTarget | FilterTarget | FxTarget;

const fxTargets = Object.fromEntries(
  FX_TYPES.flatMap((fx) =>
    [...Object.entries(FX_REGISTRY[fx].params), ['mix', MIX_PARAM] as const]
      .filter(([, definition]) => !definition.options)
      .map(([param, { label, min, max, mode }]): [string, FxTarget] => [
        `${fx}.${param}`,
        { kind: 'fx', fx, param, label, scale: mode === 'log' ? 'log' : 'linear', range: [min, max] },
      ])
  )
);

const oscTargets = (osc: number): Record<string, OscTarget> => {
  const id = (knob: string) => `osc${osc + 1}.${knob}`;
  return {
    [id('gain')]: { kind: 'osc', osc, param: 'gain', label: 'Gain', scale: 'linear', range: [0, 1] },
    [id('wave')]: { kind: 'osc', osc, param: 'position', label: 'Wave', scale: 'linear', range: [0, 1] },
    // the unison detune: the spread of the voices in cents
    [id('detune')]: { kind: 'osc', osc, param: 'spread', label: 'Detune', scale: 'linear', range: [0, 100] },
  };
};

const filterTargets: Record<string, FilterTarget> = {
  'filter.cutoff': { kind: 'filter', param: 'cutoff', label: 'Cutoff' },
  'filter.resonance': { kind: 'filter', param: 'resonance', label: 'Res' },
  'filter.gain': { kind: 'filter', param: 'gain', label: 'Gain' },
};

export const MOD_TARGETS: Record<string, ModTarget> = {
  ...oscTargets(0),
  ...oscTargets(1),
  ...filterTargets,
  ...fxTargets,
};

// the scale and the range of a knob of the filter for its type; disabled: the type doesn't use it (a route
// on it stays, but is not applied)
export const filterTargetScale = (type: BiquadFilterType, param: FilterNumerics) => {
  const { min, max, mode, disabled = false } = rangesOf(type)[param];
  return {
    scale: (mode === 'log' ? 'log' : 'linear') as ModScale,
    range: [min, max] as [number, number],
    disabled,
  };
};

export const isModTarget = (id: string) => id in MOD_TARGETS;

// the amount of a route in the units of the param (octaves for a log one)
export const amountInUnits = (amount: number, scale: ModScale, [min, max]: [number, number]) =>
  scale === 'log' ? amount * Math.log2(max / min) : amount * (max - min);
