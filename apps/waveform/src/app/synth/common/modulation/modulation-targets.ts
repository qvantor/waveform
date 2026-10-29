import type { FilterNumerics } from '@waveform/ui-kit';
import {
  ENVELOPE_TIME_MAX,
  FX_TYPES,
  FxType,
  isLfo,
  LFO_RATE_MAX,
  LFO_RATE_MIN,
  LFO_SMOOTH_MAX,
  LFOS,
  LfoKnob,
  MOD_SOURCES,
  ModSource,
} from '@waveform/preset-schema';
import { rangesOf } from '../../filter/constants';
import { FX_REGISTRY, MIX_PARAM } from '../../fx/effects';
import { OscParam } from '../wavetable/wavetable-osc-params';
import type { ModRoute } from '../modules/modulation';
import type { FxRoute } from '../../fx/effects/fx-modulation';

// the knobs a source (ENV 1–3, VELO, LFO 1–4) can be assigned to, by id (`osc1.wave`): the drop targets of the
// tabs and the keys of the routes in the preset. An amount is a share of the range of the knob in its scale: in
// the units of the param it moves that is amount × (max - min), for a log knob amount × log2(max / min) octaves,
// for a pow one (the times of the LFOs) a share of its travel

export type ModScale = 'linear' | 'log' | 'pow';

// a param of the voice node of each note (wavetable-osc-params.ts), moved by the envelopes of the note;
// range: of the knob, in the units of the param (the Wave knob shows frames, its param is a share of the
// table: an amount moves it by the same share whatever the table). The pitch (`unit`): Pitch and Fine both move
// the detune, in cents (the amounts of a source on both add up), dragged by whole semitones and cents
interface OscTarget {
  kind: 'osc';
  osc: number;
  param: OscParam;
  label: string;
  scale: ModScale;
  range: [number, number];
  unit?: PitchUnit;
}

export type PitchUnit = 'semitones' | 'cents';
// cents of each
const PITCH_UNITS: Record<PitchUnit, number> = { semitones: 100, cents: 1 };

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

// a knob of an LFO, moved per note by the envelopes and the velocity (no LFO): Rate by the frequency (log, +
// faster), the times by the share of their travel (pow, as the knobs show them), Phase around the cycle
interface LfoTarget {
  kind: 'lfo';
  lfo: number;
  param: LfoKnob;
  label: string;
  scale: ModScale;
  range: [number, number];
}

export type ModTarget = OscTarget | FilterTarget | FxTarget | LfoTarget;

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
    // the pitch over Oct, Semi and Fine: Pitch on Semi smoothly, ±48 semitones at ±1 (no steps of semitones),
    // Fine ±100 cents
    [id('pitch')]: {
      kind: 'osc',
      osc,
      param: 'detune',
      label: 'Pitch',
      scale: 'linear',
      range: [0, 4800],
      unit: 'semitones',
    },
    [id('fine')]: {
      kind: 'osc',
      osc,
      param: 'detune',
      label: 'Fine',
      scale: 'linear',
      range: [0, 100],
      unit: 'cents',
    },
  };
};

const filterTargets: Record<string, FilterTarget> = {
  'filter.cutoff': { kind: 'filter', param: 'cutoff', label: 'Cutoff' },
  'filter.resonance': { kind: 'filter', param: 'resonance', label: 'Res' },
  'filter.gain': { kind: 'filter', param: 'gain', label: 'Gain' },
};

// the knobs of each LFO: Rate in Hz (the knob shows its period)
const LFO_KNOBS: Record<LfoKnob, Pick<LfoTarget, 'label' | 'scale' | 'range'>> = {
  rate: { label: 'Rate', scale: 'log', range: [1 / LFO_RATE_MAX, 1 / LFO_RATE_MIN] },
  delay: { label: 'Delay', scale: 'pow', range: [0, ENVELOPE_TIME_MAX] },
  rise: { label: 'Rise', scale: 'pow', range: [0, ENVELOPE_TIME_MAX] },
  smooth: { label: 'Smooth', scale: 'pow', range: [0, LFO_SMOOTH_MAX] },
  phase: { label: 'Phase', scale: 'linear', range: [0, 1] },
};
const lfoTargets = Object.fromEntries(
  LFOS.flatMap((id, lfo) =>
    (Object.keys(LFO_KNOBS) as LfoKnob[]).map((param): [string, LfoTarget] => [
      `${id}.${param}`,
      { kind: 'lfo', lfo, param, ...LFO_KNOBS[param] },
    ])
  )
);

export const MOD_TARGETS: Record<string, ModTarget> = {
  ...oscTargets(0),
  ...oscTargets(1),
  ...filterTargets,
  ...fxTargets,
  ...lfoTargets,
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

// a knob whose range is centered on 0 (min = -max: a side, a boost or a cut; the gain of the filter is the boost
// or the cut of its shelves): a route dropped on it moves it around its value (bipolar), on the others up from it
export const centered = (id: string) => {
  const definition = MOD_TARGETS[id];
  if (!definition) return false;
  if (definition.kind === 'filter') return definition.param === 'gain';
  return definition.range[0] === -definition.range[1];
};

// a route of an LFO on the pitch is a vibrato: around the note; the others by centered
export const bipolarByDefault = (source: ModSource, target: string) => {
  const definition = MOD_TARGETS[target];
  return centered(target) || (isLfo(source) && definition?.kind === 'osc' && !!definition.unit);
};

// the amount of a target of the pitch in its units (semitones, cents) and the steps of an amount that are whole
// ones: Pitch 48, Fine 100
export const pitchAmount = (amount: number, unit: PitchUnit, [min, max]: [number, number]) =>
  (amount * (max - min)) / PITCH_UNITS[unit];
export const pitchAmountSteps = (unit: PitchUnit, range: [number, number]) => pitchAmount(1, unit, range);

// the amount of a route in the units of the param (octaves for a log one, a share of the travel of a pow one)
export const amountInUnits = (amount: number, scale: ModScale, [min, max]: [number, number]) =>
  scale === 'log' ? amount * Math.log2(max / min) : scale === 'pow' ? amount : amount * (max - min);

// a route of the modulation in the units of the knob it moves: the scale only when it isn't linear, bipolar only
// when it is
export const fxRoute = (
  param: string,
  { source, amount, bipolar }: ModRoute,
  scale: ModScale,
  range: [number, number]
): FxRoute => ({
  param,
  source: MOD_SOURCES.indexOf(source),
  amount: amountInUnits(amount, scale, range),
  min: range[0],
  max: range[1],
  ...(scale !== 'linear' && { scale }),
  ...(bipolar && { bipolar }),
});

// the routes of the note to the knobs of the LFOs (lfo2.rate…: of the envelopes and VELO), in the units of each
export const lfoKnobRoutes = (routes: ModRoute[]): FxRoute[] =>
  routes.flatMap((route) => {
    const definition = MOD_TARGETS[route.target];
    if (definition?.kind !== 'lfo' || route.amount === 0) return [];
    return [fxRoute(route.target, route, definition.scale, definition.range)];
  });
