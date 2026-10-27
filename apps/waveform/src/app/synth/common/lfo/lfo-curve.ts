import { curveShape } from '../envelope/envelope-curve';

// the LFOs LFO 1–4 as the voices, the fx worklets and the main thread work them out, shared by them and the specs:
// no imports but the curve of the envelopes. The Rust voice (dsp/wavetable-osc/src/lfo.rs) does the same
// operations in the same order: a level of the TS at the points of the voice is the one of the core.
//
// An LFO is a cycle of its shape (a table of LFO_TABLE_SIZE + 1 levels 0..1, the last one the first: the levels
// are read linearly) repeated every period. Its clock (one per LFO, the anchors of the main thread: at `time`
// the cycle is at `phase` and lasts `period` from there) gives the phase every note shares; a note runs it from
// its start (the start of its envelopes): during Delay its level is the left point of the shape (the level at
// the start of the cycle), then Rise morphs the left point into the shape in its time (linear), and Smooth lags
// the result (one pole, its time constant in seconds). Retrig: the cycle starts at the end of the Delay of the
// note; free: the phase of the clock. Phase shifts the cycle (0..1, both modes). Times in seconds of the context,
// the frames of the voices at their rate

export const LFO_TABLE_SIZE = 2048;
// seconds: a new Phase glides there by the shortest arc, a new shape crossfades in
export const LFO_GLIDE = 0.01;
// seconds: a change of the knobs takes over this long after now (its message reaches the audio thread before)
export const LFO_LEAD = 0.01;
// samples between the points an LFO is worked out at (the voice interpolates its routes between them)
export const LFO_SEGMENT = 32;
// the points a runner steps through to a later frame at most (0.34 s at 48 kHz): a tab hidden for minutes asks once
// for a frame far after its last point, the points before are skipped (its smoothing and the phase of a route of
// Rate from there)
const MAX_STEPS = 512;

export const RETRIG = 0;
export const FREE = 1;

export type LfoShapeName = 'sine' | 'triangle' | 'saw-up' | 'saw-down' | 'square';
// x (share of the cycle, from 0 up), y (level 0..1), k (the curve of the segment to the next point: curveShape)
export type LfoPoints = readonly (readonly [number, number, number])[];

// at `time` (seconds) the cycle is at `phase` (0..1) and lasts `period` seconds from there on
export interface LfoAnchor {
  time: number;
  phase: number;
  period: number;
}

// an LFO as the main thread sends it to the voices node and the fx worklets: its knobs, the newest anchor of its
// clock and its shape (only when it changed)
export interface LfoWire {
  // RETRIG or FREE
  mode: number;
  delay: number;
  rise: number;
  smooth: number;
  phase: number;
  anchor: LfoAnchor;
  table?: Float32Array;
}

// the LFOs from `at` (seconds of the context) on; `instantly`: there at once, no glide and no crossfade (a node
// made again)
export interface LfosState {
  at: number;
  instantly?: boolean;
  lfos: LfoWire[];
}

// the LFOs as a state leaves them after `before` (null: none yet): the table of each kept from the states before
// (a node made later takes them all at once)
export const mergeLfos = (before: LfoWire[] | null, { lfos }: LfosState): LfoWire[] =>
  lfos.map((wire, i) => ({ ...wire, table: wire.table ?? before?.[i]?.table }));

// a state as an audio thread at `now` (seconds of the context: its next block) takes it: one that comes after its
// `at` (the thread renders ahead of currentTime by a device buffer, longer than LFO_LEAD on Windows and Android)
// from now on, so its Phase still glides and its shape still crossfades. Its anchors keep their times: the clock
// stays the one of the main thread (the voices, the fx and the marks in phase), a new period applies from its
// anchor on
export const lateState = (state: LfosState, now: number): LfosState =>
  state.instantly || state.at >= now ? state : { ...state, at: now };

// the knobs of an LFO moved by the routes of a note (the envelopes, the velocity), each in its units: Rate a
// frequency (Hz), the times seconds, Phase a share of the cycle; absent: the knob
export interface LfoMods {
  rate?: number;
  delay?: number;
  rise?: number;
  smooth?: number;
  phase?: number;
}

export const frac = (x: number) => x - Math.floor(x);

// a level of `table` at the share x of the cycle (0..1), linear between its points
export const tableLevel = (table: Float32Array, x: number) => {
  const position = x * LFO_TABLE_SIZE;
  const i = Math.min(Math.floor(position), LFO_TABLE_SIZE - 1);
  const f = position - i;
  return table[i] + (table[i + 1] - table[i]) * f;
};

const shapeLevel = (shape: LfoShapeName, x: number) => {
  if (shape === 'triangle') return 1 - Math.abs(1 - 2 * x);
  if (shape === 'saw-up') return x;
  if (shape === 'saw-down') return 1 - x;
  if (shape === 'square') return x < 0.5 ? 1 : 0;
  return (1 - Math.cos(2 * Math.PI * x)) / 2;
};

// the segment of points x is in: the one of the last point at or before it (the editor reads it too)
export const segmentAt = (points: LfoPoints, x: number) => {
  let j = 0;
  for (let i = 1; i < points.length; i++) if (points[i][0] <= x) j = i;
  return j;
};

// the end of segment j: the next point, of the last one the first one over the end of the cycle (at x 1)
export const segmentEnd = (points: LfoPoints, j: number): readonly [number, number, number?] =>
  j + 1 < points.length ? points[j + 1] : [1, points[0][1]];

// the level of points at x: its segment to the end of it, curved by its k (the editor reads it too: the level a
// point is added at)
export const pointsLevel = (points: LfoPoints, x: number) => {
  const j = segmentAt(points, x);
  const [x0, y0, k] = points[j];
  const [x1, y1] = segmentEnd(points, j);
  if (x1 <= x0) return y1;
  return y0 + (y1 - y0) * curveShape(k, (x - x0) / (x1 - x0));
};

const clamp = (value: number) => (value > 1 ? 1 : value >= 0 ? value : 0);

// the table of a shape, of points of its own when there are (before the shape): `size` levels of the cycle and the
// first one again (the chart takes fewer: every 8th level of the table, the same values)
export const lfoTable = (shape: LfoShapeName, points?: LfoPoints, size = LFO_TABLE_SIZE) => {
  const table = new Float32Array(size + 1);
  for (let i = 0; i < size; i++) {
    const x = i / size;
    table[i] = clamp(points && points.length >= 2 ? pointsLevel(points, x) : shapeLevel(shape, x));
  }
  table[size] = table[0];
  return table;
};

// a cycle of any length (a frame of a wave…) as a table: read linearly around the cycle, within 0..1 (not a
// number: 0)
export const lfoTableFrom = (samples: ArrayLike<number>) => {
  const table = new Float32Array(LFO_TABLE_SIZE + 1);
  const n = samples.length;
  if (n === 0) return table;
  const level = (j: number) => (Number.isNaN(samples[j]) ? 0 : clamp(samples[j]));
  for (let i = 0; i < LFO_TABLE_SIZE; i++) {
    const position = (i * n) / LFO_TABLE_SIZE;
    const j = Math.floor(position);
    const f = position - j;
    const a = level(j);
    table[i] = a + (level((j + 1) % n) - a) * f;
  }
  table[LFO_TABLE_SIZE] = table[0];
  return table;
};

// the anchor of the clock at t: the last one at or before it (the oldest one before them all)
const anchorAt = (anchors: readonly LfoAnchor[], t: number) => {
  let anchor = anchors[0];
  for (let i = 1; i < anchors.length; i++) if (anchors[i].time <= t) anchor = anchors[i];
  return anchor;
};

// the phase of the clock at t (seconds)
export const phaseAt = (anchors: readonly LfoAnchor[], t: number) => {
  const { time, phase, period } = anchorAt(anchors, t);
  return frac(phase + (t - time) / period);
};

export const periodAt = (anchors: readonly LfoAnchor[], t: number) => anchorAt(anchors, t).period;

// a new period from t on: the anchor that keeps the phase there (no step)
export const nextAnchor = (anchors: readonly LfoAnchor[], t: number, period: number): LfoAnchor => ({
  time: t,
  phase: phaseAt(anchors, t),
  period,
});

// the anchors a clock keeps (the newest may be in the future)
export const LFO_ANCHORS = 4;
// the clock before any anchor: from 0 at the default period
export const FIRST_ANCHOR: LfoAnchor = { time: 0, phase: 0, period: 0.5 };

// the knobs of an LFO from `at` on: Phase glides from `from` to `to` by the shortest arc in LFO_GLIDE
interface Knobs {
  mode: number;
  delay: number;
  rise: number;
  smooth: number;
  from: number;
  to: number;
  arc: number;
  at: number;
}

const knobsPhase = ({ from, to, arc, at }: Knobs, t: number) => {
  if (t >= at + LFO_GLIDE) return to;
  if (t <= at) return from;
  return frac(from + arc * ((t - at) / LFO_GLIDE));
};

const sineTable = () => lfoTable('sine');

// an LFO the voices of a node (or an fx worklet, or the main thread) share: its clock, its knobs (those of a
// state from its `at` on, the ones before until then) and its shape (crossfaded into a new one in LFO_GLIDE from
// `at`: the shape at `at` and the new one; a third one meanwhile starts from where the crossfade is then)
export const createLfoGlobal = () => {
  const anchors: LfoAnchor[] = [FIRST_ANCHOR];
  let current: Knobs = { mode: RETRIG, delay: 0, rise: 0, smooth: 0, from: 0, to: 0, arc: 0, at: -Infinity };
  let next: Knobs | null = null;
  let table = sineTable();
  let previous = sineTable();
  let fadeAt = -Infinity;
  let flat = false;

  const knobs = (t: number) => (next && t >= next.at ? next : current);
  const weight = (t: number) => (t >= fadeAt + LFO_GLIDE ? 1 : t <= fadeAt ? 0 : (t - fadeAt) / LFO_GLIDE);
  const shape = (x: number, t: number) => {
    const w = weight(t);
    if (w === 1) return tableLevel(table, x);
    const a = tableLevel(previous, x);
    return a + (tableLevel(table, x) - a) * w;
  };

  return {
    // the state of the LFO from `at` on
    set: (at: number, wire: LfoWire, instantly = false) => {
      const { anchor } = wire;
      const newest = anchors[anchors.length - 1];
      if (anchor.time !== newest.time || anchor.phase !== newest.phase || anchor.period !== newest.period) {
        if (anchors.length === LFO_ANCHORS) anchors.shift();
        anchors.push({ ...anchor });
      }
      const from = instantly ? wire.phase : knobsPhase(knobs(at), at);
      const set: Knobs = {
        mode: wire.mode,
        delay: wire.delay,
        rise: wire.rise,
        smooth: wire.smooth,
        from,
        to: wire.phase,
        arc: frac(wire.phase - from + 0.5) - 0.5,
        at,
      };
      if (instantly) {
        current = set;
        next = null;
      } else {
        if (next && next.at <= at) current = next;
        next = set;
      }
      if (wire.table) {
        if (instantly) {
          previous = Float32Array.from(wire.table);
          fadeAt = -Infinity;
        } else {
          const w = weight(at);
          const baked = new Float32Array(previous.length);
          for (let i = 0; i < baked.length; i++) baked[i] = previous[i] + (table[i] - previous[i]) * w;
          previous = baked;
          fadeAt = at;
        }
        table = Float32Array.from(wire.table);
        flat = table.every((value) => value === table[0]);
      }
    },
    knobs,
    // the Phase knob at t
    phase: (t: number) => knobsPhase(knobs(t), t),
    clock: (t: number) => phaseAt(anchors, t),
    period: (t: number) => periodAt(anchors, t),
    shape,
    // a new shape crossfades in at t, or will after it
    fading: (t: number) => t < fadeAt + LFO_GLIDE,
    // every level of its shape is the same
    get flat() {
      return flat;
    },
    get pending() {
      return next;
    },
    get fadeAt() {
      return fadeAt;
    },
    get anchors(): readonly LfoAnchor[] {
      return anchors;
    },
  };
};
export type LfoGlobal = ReturnType<typeof createLfoGlobal>;

// a note runs an LFO: from `start` (seconds of the context: the start of its envelopes), its level worked out at
// points (frames at `sampleRate`) as the voice does: the end of the Delay (tD, at the first point past it: the
// end itself, or the point before it when a route moved it there), the phase of the clock there (Retrig starts
// there), the phase the routes of Rate add (δ: ∫ the frequency they move it to - the knob's, from tD), the
// smoothed level. retrigger() starts it again at a frame (mono: the envelopes start again there): the Delay and
// Rise again, Retrig its phase too, the smoothing goes on. A runner without a note (free()) runs on the clock,
// its Delay and Rise passed
export const createLfoRunner = (sampleRate: number) => {
  let start = 0;
  let restart = Infinity;
  let tD = Infinity;
  let phaseD = 0;
  let delta = 0;
  let out = NaN;
  // the frame of the last point (NaN: none yet)
  let last = NaN;
  let noteless = false;
  // the share of the cycle of the last point (the left point before tD)
  let position = 0;

  // the level at frame `f`
  const point = (f: number, lfo: LfoGlobal, mods?: LfoMods | null) => {
    const t = f / sampleRate;
    const knobs = lfo.knobs(t);
    if (t >= restart) {
      start = restart;
      restart = Infinity;
      tD = Infinity;
      if (knobs.mode !== FREE) delta = 0;
    }
    const delay = mods?.delay ?? knobs.delay;
    const rise = mods?.rise ?? knobs.rise;
    const smooth = mods?.smooth ?? knobs.smooth;
    const phase = mods?.phase ?? lfo.phase(t);
    const previous = last / sampleRate;
    if (tD === Infinity && t - start >= delay) {
      tD = Math.max(start + delay, previous >= start ? previous : start);
      phaseD = lfo.clock(tD);
    }
    // (from the point before, not before tD; at the first point from tD: a runner that starts late runs as if it
    // had all along, at the frequency of then)
    if (tD !== Infinity && mods?.rate !== undefined) {
      const extra = mods.rate - 1 / lfo.period(t);
      delta += extra * (t - (previous > tD ? previous : tD));
    }
    const clock = lfo.clock(t);
    const theta = noteless || knobs.mode === FREE ? clock + delta : clock - phaseD + delta;
    const c = lfo.shape(0, t);
    let x = c;
    position = 0;
    if (t >= tD) {
      position = frac(theta + phase);
      const y = lfo.shape(position, t);
      const r = rise > 0 ? Math.min(1, (t - tD) / rise) : 1;
      x = c + (y - c) * r;
    }
    if (Number.isNaN(out)) out = c;
    if (smooth > 0) {
      const frames = Number.isNaN(last) ? 0 : f - last;
      out += (x - out) * (1 - Math.exp(-(frames / (sampleRate * smooth))));
    } else out = x;
    last = f;
    return out;
  };

  return {
    // a note from frame `frame` (its envelopes)
    start: (frame: number) => {
      start = frame / sampleRate;
      restart = Infinity;
      tD = Infinity;
      delta = 0;
      out = NaN;
      last = NaN;
      noteless = false;
    },
    // no note: on the clock, Delay and Rise passed (the fx without a note)
    free: () => {
      start = -Infinity;
      restart = Infinity;
      tD = -Infinity;
      phaseD = 0;
      delta = 0;
      out = NaN;
      last = NaN;
      noteless = true;
    },
    retrigger: (frame: number) => {
      restart = frame / sampleRate;
    },
    point,
    // the level at frame `frame` (fractional: the main thread), worked out from the last point on in steps of
    // LFO_SEGMENT at most; a frame before the last point gives the level there
    at: (frame: number, lfo: LfoGlobal, mods?: (t: number) => LfoMods | null) => {
      if (!Number.isNaN(last)) {
        if (frame <= last) return out;
        const from = Math.max(last + LFO_SEGMENT, frame - MAX_STEPS * LFO_SEGMENT);
        for (let f = from; f < frame; f += LFO_SEGMENT) point(f, lfo, mods?.(f / sampleRate));
      }
      return point(frame, lfo, mods?.(frame / sampleRate));
    },
    get started() {
      return !Number.isNaN(last);
    },
    get position() {
      return position;
    },
  };
};
