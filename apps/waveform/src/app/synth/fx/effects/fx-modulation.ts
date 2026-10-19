import { EnvelopeParams, envelopeValue } from '../../common/envelope/envelope-curve';

// the modulation of the fx knobs: there is one fx for the whole synth, so its knobs follow the envelopes of the
// last note pressed (in legato its phrase: a note of the phrase doesn't start them again). Shared by the main
// thread and the fx worklets: no other imports

// the envelopes of the last note (read when it was pressed), the seconds of the context they started at and
// were released at (null: the key is held)
export interface FxNote {
  envelopes: EnvelopeParams[];
  start: number;
  release: number | null;
}

// a route to a knob of an effect: envelope `env` moves `param` by amount × its level, in the units of the
// param (octaves for a log one: the knob × 2^(amount × level)); clamped to the range of the knob
export interface FxRoute {
  param: string;
  env: number;
  amount: number;
  min: number;
  max: number;
  log?: boolean;
}

// what an effect follows: the last note and the routes to its knobs; null while it isn't modulated (no route,
// no note yet, or the effect isn't in the chain or bypassed: then nothing is computed)
export interface FxModulation {
  note: FxNote;
  routes: FxRoute[];
}

// main thread → fx worklet
export interface FxModMessage {
  mod?: FxModulation | null;
}

// the levels of the envelopes of the note at t (seconds of the context): each route sums amount × level
const level = (note: FxNote, env: number, t: number) =>
  envelopeValue(
    note.envelopes[env],
    t - note.start,
    note.release === null ? Infinity : note.release - note.start
  );

// a knob moved by its routes at t: base + Σ amount × level (base × 2^Σ for a log one), clamped to its range
export const routedValue = (base: number, routes: FxRoute[], note: FxNote, t: number) => {
  let sum = 0;
  for (let r = 0; r < routes.length; r++) sum += routes[r].amount * level(note, routes[r].env, t);
  const { min, max, log } = routes[0];
  const value = log ? base * 2 ** sum : base + sum;
  return Math.min(max, Math.max(min, value));
};

// the routes grouped by knob
export const routesByParam = (routes: FxRoute[]) =>
  routes.reduce<Record<string, FxRoute[]>>((groups, route) => {
    (groups[route.param] ??= []).push(route);
    return groups;
  }, {});

// the modulation in an fx worklet: bases() takes the knobs posted to it and lets through those no route moves
// (the moved ones are set at the next block), block() gives the values to set at the block of `frame`: the
// moved knobs whose value has changed (one value per block: the dsp glides to it), and a knob that lost its
// route back at its base. Without a route nothing is computed
export const createFxModulator = (sampleRate: number, initial: Record<string, number>) => {
  const bases: Record<string, number> = { ...initial };
  let note: FxNote | null = null;
  let moved: { param: string; routes: FxRoute[]; last: number }[] = [];
  // knobs to set at the next block: back at their base, or moved anew
  let pending: string[] = [];

  return {
    set: (mod: FxModulation | null) => {
      const before = moved.map(({ param }) => param);
      note = mod?.note ?? null;
      const groups = mod ? routesByParam(mod.routes) : {};
      moved = Object.keys(groups).map((param) => ({ param, routes: groups[param], last: NaN }));
      pending = before.filter((param) => !(param in groups));
    },
    bases: (params: Record<string, number>) => {
      let passed: Record<string, number> | null = null;
      Object.keys(params).forEach((key) => {
        bases[key] = params[key];
        const knob = moved.find(({ param }) => param === key);
        if (knob) knob.last = NaN;
        else (passed ??= {})[key] = params[key];
      });
      return passed;
    },
    block: (frame: number) => {
      if (moved.length === 0 && pending.length === 0) return null;
      let values: Record<string, number> | null = null;
      for (let i = 0; i < pending.length; i++) (values ??= {})[pending[i]] = bases[pending[i]];
      pending = [];
      if (!note) return values;
      const t = frame / sampleRate;
      for (let i = 0; i < moved.length; i++) {
        const knob = moved[i];
        const value = routedValue(bases[knob.param], knob.routes, note, t);
        if (value === knob.last) continue;
        knob.last = value;
        (values ??= {})[knob.param] = value;
      }
      return values;
    },
  };
};
