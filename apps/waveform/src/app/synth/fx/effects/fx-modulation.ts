import { EnvelopeParams, envelopeValue } from '../../common/envelope/envelope-curve';
import {
  createLfoGlobal,
  createLfoRunner,
  frac,
  LfoGlobal,
  LfoMods,
  LfosState,
} from '../../common/lfo/lfo-curve';

// the modulation of the fx knobs: there is one fx for the whole synth, so its knobs follow the envelopes and the
// LFOs of the last note pressed (in legato its phrase: a note of the phrase doesn't start them again; the LFOs run
// without a note too, on their clocks). Shared by the main thread and the fx worklets: no other imports

// the envelopes of the last note (read when it was pressed), the seconds of the context they started at and
// were released at (null: the key is held); a note that started them again on a voice that sounds (mono):
// the levels they start their attacks from (0 without). Its velocity: VELO, the source after the envelopes
// (constant for the note), and its share of 127 (the dot of the chart of the velocity)
export interface FxNote {
  envelopes: EnvelopeParams[];
  start: number;
  release: number | null;
  from?: number[];
  velo?: number;
  velocity?: number;
}

// the scale of a knob: linear, log (octaves), pow (a share of its travel: the times of the LFOs)
export type FxScale = 'linear' | 'log' | 'pow';

// a route to a knob of an effect or of an LFO (lfo2.rate: the routes of the note to the knobs of its LFOs): `source`
// (an envelope, the velocity after them, an LFO after it: MOD_SOURCES.indexOf) moves `param` by amount × its level
// (bipolar: amount × (level - ½)), in the units of the param in its scale (octaves for a log one: the knob ×
// 2^(amount × level)); clamped to the range of the knob (the Phase of an LFO goes around the cycle)
export interface FxRoute {
  param: string;
  source: number;
  amount: number;
  min: number;
  max: number;
  scale?: FxScale;
  bipolar?: boolean;
}

// what an effect follows: the last note (null: none yet, or a preset switch paused it: only the LFOs move, on their
// clocks) and the routes to its knobs and to the knobs of the LFOs; null while it isn't modulated (no route, no
// note and no route of an LFO, or the effect isn't in the chain or bypassed: then nothing is computed)
export interface FxModulation {
  note: FxNote | null;
  routes: FxRoute[];
}

// main thread → fx worklet: the modulation, the LFOs (lfo-curve.ts: their knobs, clocks and shapes)
export interface FxModMessage {
  mod?: FxModulation | null;
  lfos?: LfosState;
}

// the index of LFO 1 among the sources (MOD_SOURCES: ENV 1–3, VELO, LFO 1–4)
export const LFO_SOURCE = 4;
const LFO_COUNT = 4;

// `source` reads an envelope (else the velocity, VELO, the same all along the note, or an LFO)
export const isEnvelope = (note: FxNote, source: number) => source < note.envelopes.length;
export const isLfoSource = (source: number) => source >= LFO_SOURCE;

// the level of source `source` (an envelope, VELO) of the note t seconds after its start: each route sums amount ×
// level, the marks of the knobs show it
export const noteLevel = (note: FxNote, source: number, t: number) => {
  if (!isEnvelope(note, source)) return isLfoSource(source) ? 0 : note.velo ?? 0;
  const released = note.release === null ? Infinity : note.release - note.start;
  return envelopeValue(note.envelopes[source], t, released, note.from?.[source]);
};

// what a route adds to the sum of the routes of its knob at `level` of its source: amount × level (amount ×
// (level - ½) of a bipolar one)
export const routeTerm = ({ amount, bipolar }: FxRoute, level: number) =>
  amount * (bipolar ? level - 0.5 : level);

// a knob moved from `base` by `sum`, the sum of its routes, in the scale of the knob (of `route`, its first), not
// clamped: base + Σ (log: base × 2^Σ; pow: max × (its share of the travel + Σ)⁴ within the travel)
export const movedBy = (base: number, sum: number, { scale, max }: FxRoute) => {
  if (scale === 'log') return base * 2 ** sum;
  if (scale === 'pow') {
    const share = Math.min(1, Math.max(0, Math.sqrt(Math.sqrt(base / max)) + sum));
    return max * share * share * share * share;
  }
  return base + sum;
};

// a knob moved from `base` by its routes, the level of each route by `level`, not clamped
export const movedUnclamped = (base: number, routes: FxRoute[], level: (route: FxRoute) => number) => {
  let sum = 0;
  for (let r = 0; r < routes.length; r++) sum += routeTerm(routes[r], level(routes[r]));
  return movedBy(base, sum, routes[0]);
};

const clampTo = (value: number, { min, max }: FxRoute) => Math.min(max, Math.max(min, value));

// a knob moved by its routes of the note at t (seconds of the context), clamped to its range (the envelopes and VELO
// of the note; an LFO there: 0)
export const routedValue = (base: number, routes: FxRoute[], note: FxNote, t: number) =>
  clampTo(
    movedUnclamped(base, routes, (route) => noteLevel(note, route.source, t - note.start)),
    routes[0]
  );

// the routes grouped by knob
export const routesByParam = (routes: FxRoute[]) =>
  routes.reduce<Record<string, FxRoute[]>>((groups, route) => {
    (groups[route.param] ??= []).push(route);
    return groups;
  }, {});

// a route to a knob of an LFO: lfo1.rate…
const LFO_KNOB = /^lfo([1-4])\.(rate|delay|rise|smooth|phase)$/;
export const isLfoKnob = (param: string) => LFO_KNOB.test(param);

// the LFOs of the last note, as the voices run them (the main thread: the marks of the knobs and the dot of the
// chart; an fx worklet: its knobs): their states (setLfos), a runner of each from the start of the envelopes of the
// note (a note that started them again, mono: again from there; no note: on the clock, their Delay and Rise
// passed), its knobs moved by the routes of the note to them (setRoutes: of the envelopes and VELO). level() steps
// a runner to a frame in points of 32 samples at most. The LFOs of the main thread run on those of the lfo model
// (`globals`: it sets their states)
export const createNoteLfos = (
  sampleRate: number,
  globals: LfoGlobal[] = Array.from({ length: LFO_COUNT }, createLfoGlobal)
) => {
  const runners = Array.from({ length: LFO_COUNT }, () => createLfoRunner(sampleRate));
  runners.forEach((runner) => runner.free());
  let note: FxNote | null = null;
  // the routes of the knobs of each LFO, by knob
  let knobs: [keyof LfoMods, FxRoute[]][][] = globals.map(() => []);

  // the knobs of LFO `lfo` the routes of the note move at t (seconds of the context), into one object per LFO (the
  // runner reads it at once: no garbage a point), of one shape: a knob no route moves is undefined (a delete would
  // make it a dictionary, slower at every point)
  const moved: LfoMods[] = globals.map(() => ({
    rate: undefined,
    delay: undefined,
    rise: undefined,
    smooth: undefined,
    phase: undefined,
  }));
  const modsOf = globals.map((global, lfo) => (t: number): LfoMods => {
    const mods = moved[lfo];
    const routes = knobs[lfo];
    const played = note as FxNote;
    for (let k = 0; k < routes.length; k++) {
      const [knob, list] = routes[k];
      const base =
        knob === 'rate' ? 1 / global.period(t) : knob === 'phase' ? global.phase(t) : global.knobs(t)[knob];
      let sum = 0;
      for (let r = 0; r < list.length; r++)
        sum += routeTerm(list[r], noteLevel(played, list[r].source, t - played.start));
      const value = movedBy(base, sum, list[0]);
      mods[knob] = knob === 'phase' ? frac(value) : clampTo(value, list[0]);
    }
    return mods;
  });
  const mods = (lfo: number) => (note && knobs[lfo].length > 0 ? modsOf[lfo] : undefined);

  return {
    globals,
    setLfos: ({ at, instantly, lfos }: LfosState) =>
      lfos.forEach((wire, lfo) => globals[lfo]?.set(at, wire, instantly)),
    // the note the LFOs run from: a new start starts them (again on a voice that sounds: from where they are)
    follow: (next: FxNote | null) => {
      if (next?.start === note?.start && !!next === !!note) {
        note = next;
        return;
      }
      if (!next) runners.forEach((runner) => runner.free());
      else if (note && next.from) runners.forEach((runner) => runner.retrigger(next.start * sampleRate));
      else runners.forEach((runner) => runner.start(next.start * sampleRate));
      note = next;
    },
    // the routes of the note to the knobs of the LFOs (the others are left out)
    setRoutes: (routes: FxRoute[]) => {
      const byKnob: Record<string, FxRoute[]>[] = globals.map(() => ({}));
      routes.forEach((route) => {
        const match = LFO_KNOB.exec(route.param);
        if (!match || isLfoSource(route.source)) return;
        (byKnob[Number(match[1]) - 1][match[2]] ??= []).push(route);
      });
      knobs = byKnob.map((lfo) => Object.entries(lfo) as [keyof LfoMods, FxRoute[]][]);
      moved.forEach((mods) => {
        mods.rate = mods.delay = mods.rise = mods.smooth = mods.phase = undefined;
      });
    },
    // the level of LFO `lfo` at `frame` (fractional on the main thread), the share of its cycle there
    level: (lfo: number, frame: number) => runners[lfo].at(frame, globals[lfo], mods(lfo)),
    position: (lfo: number) => runners[lfo].position,
  };
};
export type NoteLfos = ReturnType<typeof createNoteLfos>;

// the modulation in an fx worklet: bases() takes the knobs posted to it and lets through those no route moves
// (the moved ones are set at the next block), block() gives the values to set at the block of `frame`: the
// moved knobs whose value has changed (one value per block: the dsp glides to it; the LFOs worked out in points of
// 32 samples to it), and a knob that lost its route back at its base. Without a route nothing is computed; without
// a note only the routes of the LFOs move (on their clocks: the envelopes and VELO are 0)
export const createFxModulator = (
  sampleRate: number,
  initial: Record<string, number>,
  lfos: LfosState | null = null
) => {
  const bases: Record<string, number> = { ...initial };
  const noteLfos = createNoteLfos(sampleRate);
  if (lfos) noteLfos.setLfos(lfos);
  let note: FxNote | null = null;
  let moved: { param: string; routes: FxRoute[]; last: number }[] = [];
  // knobs to set at the next block: back at their base, or moved anew
  let pending: string[] = [];

  const level = (route: FxRoute, frame: number) => {
    if (isLfoSource(route.source)) return noteLfos.level(route.source - LFO_SOURCE, frame);
    return note ? noteLevel(note, route.source, frame / sampleRate - note.start) : 0;
  };

  return {
    set: (mod: FxModulation | null) => {
      const before = moved.map(({ param }) => param);
      note = mod?.note ?? null;
      noteLfos.follow(note);
      noteLfos.setRoutes(mod?.routes ?? []);
      const groups = routesByParam((mod?.routes ?? []).filter(({ param }) => !isLfoKnob(param)));
      moved = Object.keys(groups).map((param) => ({ param, routes: groups[param], last: NaN }));
      // the knobs that lost their routes, also in a set before the next block
      pending = [...new Set([...pending, ...before])].filter((param) => !(param in groups));
    },
    lfos: (state: LfosState) => {
      noteLfos.setLfos(state);
      moved.forEach((knob) => (knob.last = NaN));
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
      for (let i = 0; i < moved.length; i++) {
        const knob = moved[i];
        const value = clampTo(
          movedUnclamped(bases[knob.param], knob.routes, (route) => level(route, frame)),
          knob.routes[0]
        );
        if (value === knob.last) continue;
        knob.last = value;
        (values ??= {})[knob.param] = value;
      }
      return values;
    },
  };
};
