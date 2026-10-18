import { FRAME_GUARD, levelBase, WavetableLevels } from './wavetable-levels';
import { oscParamName, VoiceParam } from './wavetable-osc-params';

// the wavetable oscillator runs in an audio worklet (wavetable-osc.worklet.ts), this is its signal
// processing: the store of the band-limited tables (wavetable-mipmap.ts) and the voice, one per note, that
// plays both oscillators with their unison voices into one stereo output

// an oscillator of a voice, null in VoiceOptions.osc: off for the note
export interface VoiceOscOptions {
  // the table in the store, a voice plays its latest version
  table: string;
  // voices 1..8, detune 0 (spread at the start of the note) plays one
  unison: number;
  // shares of a period: the start phase of every unison voice and the most of its random shift (1: any phase)
  phase: number;
  phaseRand: number;
}

export interface VoiceOptions {
  osc: (VoiceOscOptions | null)[];
  // seconds of the context time the note starts at
  start: number;
  // posts a VoiceStartedMessage once (the perf test hook times the notes)
  trace?: boolean;
}

// voice → main thread: the voice has ended, its node can be disconnected
export interface VoiceEndedMessage {
  ended: true;
}
// voice → main thread, once, for a traced voice: the frame it was scheduled at and the one it started at (its
// first block: later when the node was created after its start)
export interface VoiceStartedMessage {
  started: number;
  scheduled: number;
}

// main thread → store or worker: their counters (the perf test hook)
export interface StatsRequest {
  stats: true;
}
// the tables of the store, the versions held (by the store or by voices still playing a replaced one) and
// their bytes
export interface TableStoreStats {
  tables: number;
  versions: number;
  bytes: number;
}
// the voices of a scope: processors alive and their unison voices; unison-voice samples played from mix tables
// and directly (once during a crossfade into a new version; silent spans above the nyquist are not played);
// mix builds, their multiply-adds and those the budget refused; the most multiply-adds of builds in one block
// since the last read; the mix tables allocated (the pool reuses them, a voice that ends gives them back) and
// their bytes
export interface VoiceStats {
  voices: number;
  unison: number;
  mixSamples: number;
  directSamples: number;
  builds: number;
  buildCost: number;
  refused: number;
  peakCost: number;
  mixes: number;
  mixBytes: number;
}
// store → main thread: the answer to a StatsRequest, at the frame it was read
export interface StoreStatsMessage {
  stats: TableStoreStats & VoiceStats & { frame: number };
}

// worker → store (its MessagePort): a new version of a table (its data buffer transferred), or a table that
// is gone (its oscillator was destroyed). store → worker: a version no voice plays anymore, its buffer
// transferred back to be reused, so the audio thread never collects 64 MB
export interface StoreTableMessage {
  table: string;
  version: number;
  levels?: WavetableLevels;
  remove?: boolean;
}
export interface StoreFreedMessage {
  freed: ArrayBuffer;
}

export const MAX_UNISON = 8;
// samples between the points where a changing pitch is worked out (pow, log2), linear in between
const SEGMENT = 32;
// the render quantum, the buffers grow if a block is longer
const BLOCK = 128;
// seconds: the fade-in of a voice at a random phase, the fade-out of a stolen voice, the crossfade into a
// new version of the table
export const FADE_IN = 0.0015;
export const KILL_FADE = 0.005;
export const CROSSFADE = 0.01;
// a position this close to a frame (in frames) plays the frame alone: an AudioParam is a float32, k / (N - 1)
// times N - 1 is not exactly k
const SNAP = 1e-4;

// a version of a table held by the store and the voices that play it
export interface TableEntry {
  table: string;
  version: number;
  levels: WavetableLevels;
  refs: number;
}

// the tables of an AudioContext (one store per AudioWorkletGlobalScope), by id; a version stays until no
// voice plays it and a newer one has replaced it, then onFree gets its levels (the worklet hands the buffer
// back to the worker)
export const createTableStore = (onFree: (levels: WavetableLevels) => void = () => undefined) => {
  const current = new Map<string, TableEntry>();
  // the versions held and their bytes (counted before onFree: it transfers the buffer)
  let versions = 0;
  let bytes = 0;
  const release = (entry: TableEntry) => {
    if (--entry.refs !== 0) return;
    if (__PERF__) {
      versions--;
      bytes -= entry.levels.data.byteLength;
    }
    onFree(entry.levels);
  };
  return {
    // a stale version (an older one arriving after a newer one) is freed at once
    set: (table: string, version: number, levels: WavetableLevels) => {
      const previous = current.get(table);
      if (previous && previous.version >= version) return onFree(levels);
      current.set(table, { table, version, levels, refs: 1 });
      if (__PERF__) {
        versions++;
        bytes += levels.data.byteLength;
      }
      if (previous) release(previous);
    },
    remove: (table: string) => {
      const previous = current.get(table);
      current.delete(table);
      if (previous) release(previous);
    },
    latest: (table: string) => current.get(table) ?? null,
    acquire: (entry: TableEntry) => {
      entry.refs++;
      return entry;
    },
    release,
    stats: (): TableStoreStats => ({ tables: current.size, versions, bytes }),
  };
};
export type TableStore = ReturnType<typeof createTableStore>;

// played until the table of an oscillator has arrived: one sine cycle (as PLACEHOLDER_WAVE of the model), its
// levels as built by wavetable-mipmap (levelHarmonics(1): 1, 1, 1, 1, 0), the four sines share their samples
const sineLevels = (): WavetableLevels => {
  const length = 256;
  const stride = length + FRAME_GUARD;
  const levels: WavetableLevels = {
    frames: 1,
    harmonics: Int32Array.of(1, 1, 1, 1, 0),
    lengths: Int32Array.of(length, length, length, length, length),
    offsets: Int32Array.of(0, 0, 0, 0, stride),
    data: new Float32Array(2 * stride),
  };
  for (let i = -1; i <= length + 1; i++) levels.data[1 + i] = Math.sin((2 * Math.PI * i) / length);
  return levels;
};
const SINE: TableEntry = { table: '', version: -1, levels: sineLevels(), refs: Infinity };

// the render loops: one voice over the samples s0..s1 of a block, × g added to out; they return the phase.
// ph: phase (share of the period), inc: its step per sample, dInc: the change of the step per sample (a glide
// between two pitch points). o: sample 0 of a frame on a level, len: its length; the next
// frame (at + stride) weighs m (+ dm per sample: the morph); a second level weighs w (+ dw per sample),
// Same: of the same length (one index for both). Linear interpolation between two samples, as a native
// oscillator. Each case has a loop of its own and the reads are inlined: no call or closure per sample,
// whose double results V8 would box
const render11 = (
  t: Float32Array,
  o: number,
  len: number,
  ph: number,
  inc: number,
  dInc: number,
  g: number,
  out: Float32Array,
  s0: number,
  s1: number
) => {
  for (let i = s0; i < s1; i++) {
    const x = ph * len;
    const xi = x | 0;
    const f = x - xi;
    const p = o + xi;
    const va = t[p];
    const v = va + (t[p + 1] - va) * f;
    out[i] += g * v;
    ph += inc;
    if (ph >= 1) ph -= 1;
    inc += dInc;
  }
  return ph;
};
const render12 = (
  t: Float32Array,
  o: number,
  stride: number,
  len: number,
  m: number,
  dm: number,
  ph: number,
  inc: number,
  dInc: number,
  g: number,
  out: Float32Array,
  s0: number,
  s1: number
) => {
  for (let i = s0; i < s1; i++) {
    const x = ph * len;
    const xi = x | 0;
    const f = x - xi;
    const p = o + xi;
    const aa = t[p];
    const a = aa + (t[p + 1] - aa) * f;
    const ba = t[p + stride];
    const b = ba + (t[p + stride + 1] - ba) * f;
    const v = a + (b - a) * m;
    out[i] += g * v;
    m += dm;
    ph += inc;
    if (ph >= 1) ph -= 1;
    inc += dInc;
  }
  return ph;
};
const render21Same = (
  t: Float32Array,
  o1: number,
  len1: number,
  o2: number,
  w: number,
  dw: number,
  ph: number,
  inc: number,
  dInc: number,
  g: number,
  out: Float32Array,
  s0: number,
  s1: number
) => {
  for (let i = s0; i < s1; i++) {
    const x1 = ph * len1;
    const xi1 = x1 | 0;
    const f1 = x1 - xi1;
    const p1 = o1 + xi1;
    const v1a = t[p1];
    const v1 = v1a + (t[p1 + 1] - v1a) * f1;
    const p2 = o2 + xi1;
    const v2a = t[p2];
    const v2 = v2a + (t[p2 + 1] - v2a) * f1;
    out[i] += g * (v1 + (v2 - v1) * w);
    w += dw;
    ph += inc;
    if (ph >= 1) ph -= 1;
    inc += dInc;
  }
  return ph;
};
const render22Same = (
  t: Float32Array,
  o1: number,
  stride1: number,
  len1: number,
  o2: number,
  stride2: number,
  m: number,
  dm: number,
  w: number,
  dw: number,
  ph: number,
  inc: number,
  dInc: number,
  g: number,
  out: Float32Array,
  s0: number,
  s1: number
) => {
  for (let i = s0; i < s1; i++) {
    const x1 = ph * len1;
    const xi1 = x1 | 0;
    const f1 = x1 - xi1;
    const p1 = o1 + xi1;
    const a1a = t[p1];
    const a1 = a1a + (t[p1 + 1] - a1a) * f1;
    const b1a = t[p1 + stride1];
    const b1 = b1a + (t[p1 + stride1 + 1] - b1a) * f1;
    const v1 = a1 + (b1 - a1) * m;
    const p2 = o2 + xi1;
    const a2a = t[p2];
    const a2 = a2a + (t[p2 + 1] - a2a) * f1;
    const b2a = t[p2 + stride2];
    const b2 = b2a + (t[p2 + stride2 + 1] - b2a) * f1;
    const v2 = a2 + (b2 - a2) * m;
    out[i] += g * (v1 + (v2 - v1) * w);
    w += dw;
    m += dm;
    ph += inc;
    if (ph >= 1) ph -= 1;
    inc += dInc;
  }
  return ph;
};
const render21 = (
  t: Float32Array,
  o1: number,
  len1: number,
  o2: number,
  len2: number,
  w: number,
  dw: number,
  ph: number,
  inc: number,
  dInc: number,
  g: number,
  out: Float32Array,
  s0: number,
  s1: number
) => {
  for (let i = s0; i < s1; i++) {
    const x1 = ph * len1;
    const xi1 = x1 | 0;
    const f1 = x1 - xi1;
    const x2 = ph * len2;
    const xi2 = x2 | 0;
    const f2 = x2 - xi2;
    const p1 = o1 + xi1;
    const v1a = t[p1];
    const v1 = v1a + (t[p1 + 1] - v1a) * f1;
    const p2 = o2 + xi2;
    const v2a = t[p2];
    const v2 = v2a + (t[p2 + 1] - v2a) * f2;
    out[i] += g * (v1 + (v2 - v1) * w);
    w += dw;
    ph += inc;
    if (ph >= 1) ph -= 1;
    inc += dInc;
  }
  return ph;
};
const render22 = (
  t: Float32Array,
  o1: number,
  stride1: number,
  len1: number,
  o2: number,
  stride2: number,
  len2: number,
  m: number,
  dm: number,
  w: number,
  dw: number,
  ph: number,
  inc: number,
  dInc: number,
  g: number,
  out: Float32Array,
  s0: number,
  s1: number
) => {
  for (let i = s0; i < s1; i++) {
    const x1 = ph * len1;
    const xi1 = x1 | 0;
    const f1 = x1 - xi1;
    const x2 = ph * len2;
    const xi2 = x2 | 0;
    const f2 = x2 - xi2;
    const p1 = o1 + xi1;
    const a1a = t[p1];
    const a1 = a1a + (t[p1 + 1] - a1a) * f1;
    const b1a = t[p1 + stride1];
    const b1 = b1a + (t[p1 + stride1 + 1] - b1a) * f1;
    const v1 = a1 + (b1 - a1) * m;
    const p2 = o2 + xi2;
    const a2a = t[p2];
    const a2 = a2a + (t[p2 + 1] - a2a) * f2;
    const b2a = t[p2 + stride2];
    const b2 = b2a + (t[p2 + stride2 + 1] - b2a) * f2;
    const v2 = a2 + (b2 - a2) * m;
    out[i] += g * (v1 + (v2 - v1) * w);
    w += dw;
    m += dm;
    ph += inc;
    if (ph >= 1) ph -= 1;
    inc += dInc;
  }
  return ph;
};

// the length of the tables of a browser's PeriodicWave at the rate (Chrome and WebKit: 2048 up to 24 kHz, 4096
// up to 88.2 kHz, 16384 above), its oscillator reads them linearly: a mix table as long has the same aliasing
export const nativeTableLength = (sampleRate: number) =>
  sampleRate <= 24000 ? 2048 : sampleRate <= 88200 ? 4096 : 16384;

type Params = Record<VoiceParam, Float32Array>;

// the cost of the mix tables built per block at most (multiply-adds), across all the voices of a context
// (they render one after another on the audio thread): a chord of new notes converts to them over a few
// blocks instead of one long block (about 0.2 ms of a block at most)
export const MIX_BUDGET = 200000;
// the points of the interpolation that brings a shorter level to the length of a mix
export const UPSAMPLER_TAPS = 6;

// the counters of VoiceStats in the typed array of the shared voices (the render loops add to it: no boxed
// doubles)
const VOICES = 0;
const UNISON = 1;
const MIX_SAMPLES = 2;
const DIRECT_SAMPLES = 3;
const BUILDS = 4;
const BUILD_COST = 5;
const REFUSED = 6;
const PEAK_COST = 7;
const MIXES = 8;
const MIX_BYTES = 9;

// what the voices of a context share: the buffers of a block (they render one after another, never at once),
// the mix tables (pooled: a voice that ends gives them back, the audio thread collects nothing), the budget of
// mix builds per block and the counters of the voices
export const createVoiceShared = () => {
  let size = 0;
  const scratch = {
    // the channels of a voice (left, right, both), copied to the outputs at the end of the block: the
    // output arrays of a processor are slower to write in some engines
    left: new Float32Array(0),
    right: new Float32Array(0),
    center: new Float32Array(0),
    // the channels of an oscillator played with a gain per sample, or crossfaded into a new version (b)
    aLeft: new Float32Array(0),
    aRight: new Float32Array(0),
    aCenter: new Float32Array(0),
    bLeft: new Float32Array(0),
    bRight: new Float32Array(0),
    bCenter: new Float32Array(0),
    // a unison voice that fades in
    fading: new Float32Array(0),
    // the points of a changing pitch or position (sample indexes) and the position at each (in frames)
    points: new Int32Array(0),
    positions: new Float64Array(0),
  };
  const pool = new Map<number, Float32Array[]>();
  let budgetFrame = -1;
  let spent = 0;
  const counts = new Float64Array(10);
  return {
    counts,
    scratch: (length: number) => {
      if (length > size) {
        size = length;
        (
          [
            'left',
            'right',
            'center',
            'aLeft',
            'aRight',
            'aCenter',
            'bLeft',
            'bRight',
            'bCenter',
            'fading',
          ] as const
        ).forEach((key) => (scratch[key] = new Float32Array(length)));
        scratch.points = new Int32Array(Math.ceil(length / SEGMENT) + 2);
        scratch.positions = new Float64Array(scratch.points.length);
      }
      return scratch;
    },
    acquireMix: (length: number) => {
      const pooled = pool.get(length)?.pop();
      if (pooled) return pooled;
      const mix = new Float32Array(length + FRAME_GUARD);
      if (__PERF__) {
        counts[MIXES]++;
        counts[MIX_BYTES] += mix.byteLength;
      }
      return mix;
    },
    releaseMix: (mix: Float32Array) => {
      const length = mix.length - FRAME_GUARD;
      const free = pool.get(length) ?? [];
      free.push(mix);
      pool.set(length, free);
    },
    // a mix build of `cost` in the block at `frame`, if the budget allows (the first of a block always)
    takeBuild: (frame: number, cost: number) => {
      if (frame !== budgetFrame) {
        budgetFrame = frame;
        spent = 0;
      }
      if (spent > 0 && spent + cost > MIX_BUDGET) {
        if (__PERF__) counts[REFUSED]++;
        return false;
      }
      spent += cost;
      if (__PERF__) {
        counts[BUILDS]++;
        counts[BUILD_COST] += cost;
        if (spent > counts[PEAK_COST]) counts[PEAK_COST] = spent;
      }
      return true;
    },
    // the counters (the peak cost starts again from here)
    stats: (): VoiceStats => {
      const stats = {
        voices: counts[VOICES],
        unison: counts[UNISON],
        mixSamples: counts[MIX_SAMPLES],
        directSamples: counts[DIRECT_SAMPLES],
        builds: counts[BUILDS],
        buildCost: counts[BUILD_COST],
        refused: counts[REFUSED],
        peakCost: counts[PEAK_COST],
        mixes: counts[MIXES],
        mixBytes: counts[MIX_BYTES],
      };
      counts[PEAK_COST] = 0;
      return stats;
    },
  };
};
export type VoiceShared = ReturnType<typeof createVoiceShared>;
const SHARED = createVoiceShared();
// the counters of the voices of the scope (the worklet answers them to the main thread)
export const voiceStats = () => SHARED.stats();

// the weights of the 6-point Lagrange interpolation (5th order, the points -2..3) at the shares q / ratio of
// a sample, per ratio
const upsamplers = new Map<number, Float64Array>();
const upsampler = (ratio: number) => {
  const cached = upsamplers.get(ratio);
  if (cached) return cached;
  const weights = new Float64Array(UPSAMPLER_TAPS * ratio);
  for (let q = 0; q < ratio; q++) {
    const t = q / ratio;
    for (let a = 0; a < UPSAMPLER_TAPS; a++) {
      let weight = 1;
      for (let b = 0; b < UPSAMPLER_TAPS; b++) if (b !== a) weight *= (t - (b - 2)) / (a - b);
      weights[UPSAMPLER_TAPS * q + a] = weight;
    }
  }
  upsamplers.set(ratio, weights);
  return weights;
};

// multiply-adds of adding a level of `own` samples to a mix of `length`
const mixCost = (own: number, length: number) => (own === length ? length : UPSAMPLER_TAPS * length);

// adds `weight` × frame `index` of `level` to the mix of `length` samples (from sample 1, as a frame): a
// level as long is added as it is, a shorter one (fewer harmonics: at most 1/32 of its length) interpolated
// at the points of the mix (6-point Lagrange: its images are far below those of the linear reading of the
// mix, as of a native table)
const addToMix = (
  mix: Float32Array,
  length: number,
  levels: WavetableLevels,
  level: number,
  index: number,
  weight: number
) => {
  const { data, lengths, offsets } = levels;
  const own = lengths[level];
  const base = offsets[level] + index * (own + FRAME_GUARD) + 1;
  if (own === length) {
    for (let i = 0; i < length; i++) mix[1 + i] += weight * data[base + i];
    return;
  }
  const ratio = length / own;
  const weights = upsampler(ratio);
  const wrap = own - 1;
  for (let i = 0; i < own; i++) {
    const x0 = data[base + ((i - 2) & wrap)];
    const x1 = data[base + ((i - 1) & wrap)];
    const x2 = data[base + i];
    const x3 = data[base + ((i + 1) & wrap)];
    const x4 = data[base + ((i + 2) & wrap)];
    const x5 = data[base + ((i + 3) & wrap)];
    for (let q = 0; q < ratio; q++) {
      const c = UPSAMPLER_TAPS * q;
      mix[1 + i * ratio + q] +=
        weight *
        (weights[c] * x0 +
          weights[c + 1] * x1 +
          weights[c + 2] * x2 +
          weights[c + 3] * x3 +
          weights[c + 4] * x4 +
          weights[c + 5] * x5);
    }
  }
};

// both frames of a position (k, k + 1 at weight m) of a level into a mix
const addLevelToMix = (
  mix: Float32Array,
  length: number,
  levels: WavetableLevels,
  level: number,
  weight: number,
  k: number,
  m: number
) => {
  if (m < 1) addToMix(mix, length, levels, level, k, weight * (1 - m));
  if (m > 0) addToMix(mix, length, levels, level, k + 1, weight * m);
};

// a param of the block: one value (no automation, no input) or one per sample; the browser sends 128 equal
// values for a param with an input that is silent or constant, they take the fast path too
const isConstant = (values: Float32Array) => {
  const first = values[0];
  for (let i = 1; i < values.length; i++) if (values[i] !== first) return false;
  return true;
};

interface Osc {
  table: string;
  unison: number;
  phase: number;
  phaseRand: number;
  // the voices playing (unison, or 1 at detune 0) and their level: a channel gets ceil(n / 2) of them
  voices: number;
  level: number;
  // per voice: phase, samples of its fade-in left (at a random phase), the random share drawn at the start;
  // the phases and fades a crossfade renders both versions from
  phases: Float64Array;
  fades: Int32Array;
  savedPhases: Float64Array;
  savedFades: Int32Array;
  random: Float64Array;
  entry: TableEntry;
  // the version faded into and the samples of the crossfade done
  next: TableEntry | null;
  crossfade: number;
  // per point of the block and voice: the phase step and log2 of the frequency; cached: worked out for a
  // constant pitch, the same as long as it stays
  incs: Float64Array;
  logs: Float64Array;
  cached: boolean;
  // the pitch, the position and the version of the last block; stable: the block repeats it (for the second
  // block at least), its id changes with any of them. A voice plays from its mix table (both frames of the
  // position and both levels of its pitch summed into one table) while it was built for the current id
  last: Float64Array;
  lastEntry: TableEntry | null;
  stable: boolean;
  stableId: number;
  mixes: (Float32Array | null)[];
  mixIds: Int32Array;
  params: { position: VoiceParam; detune: VoiceParam; spread: VoiceParam; gain: VoiceParam };
}

// a voice of a note: both oscillators (null: off), each with its unison voices, into one stereo output.
// Unison voice j of n is detuned by spread · (j / (n - 1) - 1/2) cents; the middle one of an odd count (at
// the pitch of the note) plays in both channels at full level, the others alternately left and right (from
// the lowest, on the left): a voice and its mirror (the same detune, down instead of up) are on opposite
// sides, so the channels mirror each other and their sum is centred on the note; each at 1 / √ceil(n/2), the
// power of a channel stays that of one voice. Every voice starts at `phase` shifted by a random share of its period up to
// phaseRand: at 0 all of them start in phase (their peaks add up, n voices are louder at the onset and
// their beats sweep through the spectrum together), at 1 at any phase (steady, the power of one voice).
// A voice at a random phase fades in (FADE_IN), at phaseRand 0 it starts at once (a click of its wave is
// intended, as with a native oscillator). random() is drawn only here, at the note on.
// The pitch: frequency · 2^(detune / 1200), clamped to 0..nyquist; it picks the levels of the table that
// don't fold back (level r keeps base · 2^(-r/3), levelBase): the pitch range p = 1 + 3·log2(base · f / nyquist),
// level floor(p) crossfaded with the next one by its fraction (as the PeriodicWave of a browser). The
// position morphs the frames k and k + 1 linearly. A pitch or a position that changes within the block is
// worked out every SEGMENT samples, the phase step, the level weight and the position are linear in between
// (a position crossing a frame splits the segment there). The levels are read linearly (as a native
// oscillator does, the cheapest for the CPU): a level is 32 samples per cycle of its highest harmonic long
// (wavetable-mipmap.ts), a native table 4096, so a level of few harmonics folds back more. While the pitch,
// the position and the table stay (the second block on), each voice sums the frames and levels it reads into
// a mix table as long as a native table (nativeTableLength, the shorter levels interpolated into it once)
// and reads only that: a held note costs what a native oscillator does, with its aliasing; the direct
// reading is left to the notes that glide or morph. A new version of the table is crossfaded into
// (CROSSFADE). The voice starts at options.start and ends where its gate param drops to 0 (exactly, to the
// sample) or after the fade of a stolen voice (gate below 0, KILL_FADE); process() returns false from then on
export const createVoiceDsp = (
  sampleRate: number,
  options: VoiceOptions,
  store: TableStore,
  random: () => number = Math.random,
  shared: VoiceShared = SHARED
) => {
  const nyquist = sampleRate / 2;
  const log2Nyquist = Math.log2(nyquist);
  const nativeLength = nativeTableLength(sampleRate);
  const startFrame = Math.ceil(options.start * sampleRate - 1e-6);
  let stopFrame = Infinity;
  // the frame the fade of a stolen voice starts at
  let killFrom = Infinity;
  const killLength = Math.max(1, Math.round(KILL_FADE * sampleRate));
  const fadeLength = Math.max(1, Math.round(FADE_IN * sampleRate));
  const crossfadeLength = Math.max(1, Math.round(CROSSFADE * sampleRate));
  let started = false;
  let ended = false;
  let blockFrame = 0;
  // the frame the voice started at (-1 before), its unison voices (counted while it plays)
  let startedAt = -1;
  let unison = 0;
  const { counts } = shared;

  const oscs: Osc[] = [];
  options.osc.forEach((config, index) => {
    if (!config) return;
    const unison = Math.min(MAX_UNISON, Math.max(1, Math.round(config.unison)));
    const latest = store.latest(config.table);
    oscs.push({
      table: config.table,
      unison,
      phase: config.phase,
      phaseRand: config.phaseRand,
      voices: unison,
      level: 1,
      phases: new Float64Array(MAX_UNISON),
      fades: new Int32Array(MAX_UNISON),
      savedPhases: new Float64Array(MAX_UNISON),
      savedFades: new Int32Array(MAX_UNISON),
      random: Float64Array.from({ length: MAX_UNISON }, () => random()),
      entry: latest ? store.acquire(latest) : SINE,
      next: null,
      crossfade: 0,
      incs: new Float64Array(0),
      logs: new Float64Array(0),
      cached: false,
      last: new Float64Array(4).fill(NaN),
      lastEntry: null,
      stable: false,
      stableId: 0,
      mixes: new Array(MAX_UNISON).fill(null),
      mixIds: new Int32Array(MAX_UNISON).fill(-1),
      params: {
        position: oscParamName('position', index),
        detune: oscParamName('detune', index),
        spread: oscParamName('spread', index),
        gain: oscParamName('gain', index),
      },
    });
  });
  if (__PERF__) counts[VOICES]++;

  let scratch = shared.scratch(BLOCK);
  let pointsLength = 0;
  const grow = (length: number) => {
    scratch = shared.scratch(length);
    if (scratch.points.length === pointsLength) return;
    pointsLength = scratch.points.length;
    oscs.forEach((osc) => {
      osc.incs = new Float64Array(MAX_UNISON * pointsLength);
      osc.logs = new Float64Array(MAX_UNISON * pointsLength);
      osc.cached = false;
    });
  };

  // the start of the note (its first sample, i): the unison collapses at detune 0, the phases are set
  const start = (params: Params, i: number) => {
    started = true;
    if (__PERF__) startedAt = blockFrame + i;
    oscs.forEach((osc) => {
      const spread = params[osc.params.spread];
      if ((spread.length > 1 ? spread[i] : spread[0]) <= 0) osc.voices = 1;
      osc.level = 1 / Math.sqrt(Math.ceil(osc.voices / 2));
      for (let v = 0; v < osc.voices; v++) {
        const phase = osc.phase + osc.random[v] * osc.phaseRand;
        osc.phases[v] = phase - Math.floor(phase);
        osc.fades[v] = osc.phaseRand > 0 ? fadeLength : 0;
      }
      if (__PERF__) unison += osc.voices;
    });
    if (__PERF__) counts[UNISON] += unison;
  };

  // the pitch at the points of the block for every voice: the phase step and log2 of the frequency
  const pitchPoints = (osc: Osc, params: Params, count: number) => {
    const { points } = scratch;
    const frequency = params.frequency;
    const detune = params[osc.params.detune];
    const spread = params[osc.params.spread];
    const { voices, incs, logs } = osc;
    for (let p = 0; p < count; p++) {
      const s = points[p];
      const f = frequency.length > 1 ? frequency[s] : frequency[0];
      const d = detune.length > 1 ? detune[s] : detune[0];
      const sp = Math.max(0, spread.length > 1 ? spread[s] : spread[0]);
      const log2F = f > 0 ? Math.log2(f) : -Infinity;
      for (let v = 0; v < voices; v++) {
        const cents = d + (voices > 1 ? sp * (v / (voices - 1) - 0.5) : 0);
        const log = Math.min(log2Nyquist, log2F + cents / 1200);
        const index = v * pointsLength + p;
        logs[index] = log;
        incs[index] = log === -Infinity ? 0 : 2 ** log / sampleRate;
      }
    }
  };

  // the mix of a voice: as long as a native table, or the level if it is longer (a rate up to 24 kHz)
  const mixLength = (levels: WavetableLevels, level: number) => Math.max(nativeLength, levels.lengths[level]);
  // the multiply-adds of a mix of `level` and the next at weight w, of the frames k, k + 1 at weight m
  const buildCost = (levels: WavetableLevels, level: number, w: number, m: number) => {
    const length = mixLength(levels, level);
    const silent = levels.lengths.length - 1;
    const frames = m > 0 && m < 1 ? 2 : 1;
    let cost = length;
    if (w < 1 && level < silent) cost += frames * mixCost(levels.lengths[level], length);
    if (w > 0 && level + 1 < silent) cost += frames * mixCost(levels.lengths[level + 1], length);
    return cost;
  };

  // the mix of voice v for the constant pitch and position of the block (the levels and the frames it reads)
  const buildMix = (
    osc: Osc,
    v: number,
    levels: WavetableLevels,
    level: number,
    w: number,
    k: number,
    m: number
  ) => {
    const length = mixLength(levels, level);
    let mix = osc.mixes[v];
    if (!mix || mix.length !== length + FRAME_GUARD) {
      if (mix) shared.releaseMix(mix);
      mix = shared.acquireMix(length);
      osc.mixes[v] = mix;
    }
    mix.fill(0);
    const silent = levels.lengths.length - 1;
    if (w < 1 && level < silent) addLevelToMix(mix, length, levels, level, 1 - w, k, m);
    if (w > 0 && level + 1 < silent) addLevelToMix(mix, length, levels, level + 1, w, k, m);
    mix[0] = mix[length];
    mix[length + 1] = mix[1];
    mix[length + 2] = mix[2];
    osc.mixIds[v] = osc.stableId;
  };

  // a span s..e of a voice from one version: the level (w = 0) or the next (w = 1) or both, frame k (m = 0)
  // or the next (m = 1) or both; × g added to out, returns the phase
  const renderSpan = (
    levels: WavetableLevels,
    level: number,
    w: number,
    dw: number,
    k: number,
    m: number,
    dm: number,
    ph: number,
    inc: number,
    dInc: number,
    g: number,
    out: Float32Array,
    s: number,
    e: number
  ) => {
    const { data, lengths, offsets } = levels;
    let level1 = level;
    let twoLevels = true;
    if (w === 0 && dw === 0) twoLevels = false;
    else if (w === 1 && dw === 0) {
      level1 = level + 1;
      twoLevels = false;
    }
    let frame = k;
    let twoFrames = true;
    if (m === 0 && dm === 0) twoFrames = false;
    else if (m === 1 && dm === 0) {
      frame = k + 1;
      twoFrames = false;
    }
    const len1 = lengths[level1];
    const stride1 = len1 + FRAME_GUARD;
    // sample 0 of the frame on the level, after the sample before the cycle
    const o1 = offsets[level1] + frame * stride1 + 1;
    if (!twoLevels)
      return twoFrames
        ? render12(data, o1, stride1, len1, m, dm, ph, inc, dInc, g, out, s, e)
        : render11(data, o1, len1, ph, inc, dInc, g, out, s, e);
    const len2 = lengths[level + 1];
    const stride2 = len2 + FRAME_GUARD;
    const o2 = offsets[level + 1] + frame * stride2 + 1;
    if (len1 === len2)
      return twoFrames
        ? render22Same(data, o1, stride1, len1, o2, stride2, m, dm, w, dw, ph, inc, dInc, g, out, s, e)
        : render21Same(data, o1, len1, o2, w, dw, ph, inc, dInc, g, out, s, e);
    return twoFrames
      ? render22(data, o1, stride1, len1, o2, stride2, len2, m, dm, w, dw, ph, inc, dInc, g, out, s, e)
      : render21(data, o1, len1, o2, len2, w, dw, ph, inc, dInc, g, out, s, e);
  };

  // the voices of an oscillator over a..b of the block from one version of its table, × g added to the
  // channels; mixable: the pitch, the position and the version are those of the last block
  const renderVoices = (
    osc: Osc,
    entry: TableEntry,
    params: Params,
    count: number,
    a: number,
    b: number,
    l: Float32Array,
    r: Float32Array,
    c: Float32Array,
    g: number,
    mixable: boolean,
    // the samples are counted (the perf build): not those of the version a crossfade goes to, the same samples
    counted = true
  ) => {
    const { points, positions, fading } = scratch;
    const { levels } = entry;
    const silent = levels.lengths.length - 1;
    const n = levels.frames;
    if (levels.harmonics[0] === 0) {
      // a silent table: only the phases go on
      for (let v = 0; v < osc.voices; v++) {
        let phase = osc.phases[v] + osc.incs[v * pointsLength] * (b - a);
        phase -= Math.floor(phase);
        osc.phases[v] = phase;
        osc.fades[v] = Math.max(0, osc.fades[v] - (b - a));
      }
      return;
    }
    // x = 1 + 3·log2(base · f / nyquist) = offset + 3·log2(f)
    const offset = 1 + 3 * (Math.log2(levelBase(levels.harmonics[0])) - log2Nyquist);
    // the position in frames: one (snapped to a frame within SNAP) or at each point
    const position = params[osc.params.position];
    const moving = n > 1 && !isConstant(position);
    let k = 0;
    let m = 0;
    if (!moving) {
      const p = n === 1 ? 0 : Math.min(1, Math.max(0, position[0])) * (n - 1);
      k = Math.round(p);
      if (Math.abs(p - k) >= SNAP) {
        k = Math.floor(p);
        m = p - k;
      }
      if (k >= n - 1) {
        k = n - 1;
        m = 0;
      }
    } else {
      for (let p = 0; p < count; p++) {
        // the last point is past the block: the position of its last sample
        const value = position.length > 1 ? position[Math.min(points[p], b - 1)] : position[0];
        positions[p] = Math.min(1, Math.max(0, value)) * (n - 1);
      }
    }

    // the middle voice of an odd count plays in both channels, the others take turns around it
    const middle = osc.voices % 2 === 1 ? (osc.voices - 1) / 2 : -1;
    for (let v = 0; v < osc.voices; v++) {
      const fadeLeft = osc.fades[v];
      // the channel of the voice; a voice that fades in goes through `fading` first
      const side = middle >= 0 && v > middle ? v - 1 : v;
      const channel = v === middle ? c : side % 2 === 0 ? l : r;
      const out = fadeLeft > 0 ? fading : channel;
      if (fadeLeft > 0) fading.fill(0, a, b);
      let ph = osc.phases[v];
      for (let p = 0; p < count - 1; p++) {
        const s0 = points[p];
        const s1 = points[p + 1];
        const index = v * pointsLength + p;
        const inc0 = osc.incs[index];
        const length = s1 - s0;
        const dInc = (osc.incs[index + 1] - inc0) / length;
        const x0 = offset + 3 * osc.logs[index];
        const x1 = offset + 3 * osc.logs[index + 1];
        const level = Math.max(0, Math.floor(Math.min(x0, x1)));
        const w0 = Math.min(1, Math.max(0, x0 - level));
        const w1 = Math.min(1, Math.max(0, x1 - level));
        if (level + (w0 === 1 && w1 === 1 ? 1 : 0) >= silent) {
          // above the fundamental's nyquist: silent, the phase goes on
          ph += inc0 * length + (dInc * length * (length - 1)) / 2;
          ph -= Math.floor(ph);
          continue;
        }
        const dw = (w1 - w0) / length;
        if (mixable) {
          // one segment at a constant pitch and position: the mix of the voice, built now if the budget allows
          if (osc.mixIds[v] !== osc.stableId && shared.takeBuild(blockFrame, buildCost(levels, level, w0, m)))
            buildMix(osc, v, levels, level, w0, k, m);
          const mix = osc.mixes[v];
          if (mix && osc.mixIds[v] === osc.stableId) {
            ph = render11(mix, 1, mix.length - FRAME_GUARD, ph, inc0, 0, g, out, s0, s1);
            if (__PERF__ && counted) counts[MIX_SAMPLES] += length;
            continue;
          }
        }
        if (__PERF__ && counted) counts[DIRECT_SAMPLES] += length;
        if (!moving) {
          ph = renderSpan(levels, level, w0, dw, k, m, 0, ph, inc0, dInc, g, out, s0, s1);
          continue;
        }
        // the position from its point to the next, split where it crosses a frame
        let sample = s0;
        let at = positions[p];
        const dp = (positions[p + 1] - at) / length;
        while (sample < s1) {
          let frame = Math.min(Math.floor(at), n - 2);
          // going down from a frame: the frame below and its next one
          if (dp < 0 && at === frame && frame > 0) frame--;
          let end = s1;
          const edge = dp > 0 ? frame + 1 : frame;
          if (dp !== 0) {
            const cross = sample + (edge - at) / dp;
            if (cross < s1) end = Math.max(sample + 1, Math.ceil(cross));
          }
          const offsetInSegment = sample - s0;
          ph = renderSpan(
            levels,
            level,
            w0 + dw * offsetInSegment,
            dw,
            frame,
            at - frame,
            dp,
            ph,
            inc0 + dInc * offsetInSegment,
            dInc,
            g,
            out,
            sample,
            end
          );
          at += dp * (end - sample);
          sample = end;
        }
      }
      osc.phases[v] = ph;
      if (fadeLeft > 0) {
        // linear from 0 at the first sample
        let remaining = fadeLeft;
        for (let i = a; i < b; i++) {
          const gain = remaining > 0 ? 1 - remaining / fadeLength : 1;
          channel[i] += fading[i] * gain;
          if (remaining > 0) remaining--;
        }
        osc.fades[v] = remaining;
      }
    }
  };

  const releaseMixes = (osc: Osc) =>
    osc.mixes.forEach((mix, v) => {
      if (mix) shared.releaseMix(mix);
      osc.mixes[v] = null;
      osc.mixIds[v] = -1;
    });

  // an oscillator over a..b, added to the channels of the voice
  const renderOsc = (
    osc: Osc,
    params: Params,
    a: number,
    b: number,
    left: Float32Array,
    right: Float32Array,
    center: Float32Array
  ) => {
    const { points, aLeft, aRight, aCenter, bLeft, bRight, bCenter } = scratch;
    if (!osc.next) {
      const latest = store.latest(osc.table);
      if (latest && latest !== osc.entry) {
        osc.next = store.acquire(latest);
        osc.crossfade = 0;
      }
    }
    const frequency = params.frequency;
    const detune = params[osc.params.detune];
    const spread = params[osc.params.spread];
    const position = params[osc.params.position];
    const gain = params[osc.params.gain];
    const constantPitch = isConstant(frequency) && isConstant(detune) && isConstant(spread);
    // (a table of one frame is played at any position)
    const oneFrame = osc.entry.levels.frames === 1 && (!osc.next || osc.next.levels.frames === 1);
    const constantPosition = oneFrame || isConstant(position);
    // the points of the pitch and the position: one segment if they are constant, else every SEGMENT samples
    let count = 0;
    if (constantPitch && constantPosition) {
      points[count++] = a;
      points[count++] = b;
    } else {
      for (let s = a; s < b; s += SEGMENT) points[count++] = s;
      points[count++] = b;
    }

    // the same pitch, position and version as the last block: the voices may play their mixes
    const steady =
      constantPitch &&
      constantPosition &&
      !osc.next &&
      osc.last[0] === frequency[0] &&
      osc.last[1] === detune[0] &&
      osc.last[2] === spread[0] &&
      (oneFrame || osc.last[3] === position[0]) &&
      osc.lastEntry === osc.entry;
    if (!steady || !osc.stable) osc.stableId++;
    osc.stable = steady;
    osc.last[0] = frequency[0];
    osc.last[1] = detune[0];
    osc.last[2] = spread[0];
    osc.last[3] = position[0];
    osc.lastEntry = osc.entry;

    // a constant pitch is worked out once (the same in every block it stays)
    if (!(steady && osc.cached) || count !== 2) {
      // the last point is past the block: its pitch is the one of the last sample
      const last = points[count - 1];
      points[count - 1] = b - 1;
      pitchPoints(osc, params, count);
      points[count - 1] = last;
    }
    osc.cached = constantPitch && count === 2;

    const next = osc.next;
    const constantGain = isConstant(gain);
    if (!next && constantGain) {
      // straight into the channels of the voice
      renderVoices(osc, osc.entry, params, count, a, b, left, right, center, gain[0] * osc.level, steady);
      return;
    }
    // into the channels of the oscillator, then crossfaded and × the gain of each sample
    aLeft.fill(0, a, b);
    aRight.fill(0, a, b);
    aCenter.fill(0, a, b);
    if (next) {
      osc.savedPhases.set(osc.phases);
      osc.savedFades.set(osc.fades);
    }
    renderVoices(osc, osc.entry, params, count, a, b, aLeft, aRight, aCenter, osc.level, steady);
    if (next) {
      // the new version from the same phases and fades: the voices go on as they were (the same steps, so
      // the same phases at the end)
      osc.phases.set(osc.savedPhases);
      osc.fades.set(osc.savedFades);
      bLeft.fill(0, a, b);
      bRight.fill(0, a, b);
      bCenter.fill(0, a, b);
      renderVoices(osc, next, params, count, a, b, bLeft, bRight, bCenter, osc.level, false, false);
      let done = osc.crossfade;
      for (let i = a; i < b; i++) {
        const share = Math.min(1, done / crossfadeLength);
        aLeft[i] += (bLeft[i] - aLeft[i]) * share;
        aRight[i] += (bRight[i] - aRight[i]) * share;
        aCenter[i] += (bCenter[i] - aCenter[i]) * share;
        done++;
      }
      osc.crossfade = done;
      if (done >= crossfadeLength) {
        if (osc.entry !== SINE) store.release(osc.entry);
        releaseMixes(osc);
        osc.entry = next;
        osc.next = null;
      }
    }
    for (let i = a; i < b; i++) {
      const g = constantGain ? gain[0] : gain[i];
      left[i] += aLeft[i] * g;
      right[i] += aRight[i] * g;
      center[i] += aCenter[i] * g;
    }
  };

  const end = () => {
    if (ended) return;
    ended = true;
    if (__PERF__) {
      counts[VOICES]--;
      counts[UNISON] -= unison;
    }
    oscs.forEach((osc) => {
      if (osc.entry !== SINE) store.release(osc.entry);
      if (osc.next) store.release(osc.next);
      releaseMixes(osc);
    });
  };

  return {
    // a block starting at `frame` (currentFrame) into the outputs; false once the voice has ended
    process: (frame: number, params: Params, outL: Float32Array, outR: Float32Array) => {
      const n = outL.length;
      if (ended) {
        outL.fill(0);
        outR.fill(0);
        return false;
      }
      grow(n);
      blockFrame = frame;
      const a = Math.max(0, startFrame - frame);
      if (a >= n) {
        outL.fill(0);
        outR.fill(0);
        return true;
      }
      // the gate: 0 stops the voice at that sample, below 0 starts the fade of a stolen voice there
      const gate = params.gate;
      for (let i = a; gate && i < (gate.length > 1 ? n : a + 1); i++) {
        const value = gate.length > 1 ? gate[i] : gate[0];
        if (value > 0) continue;
        if (value < 0) {
          killFrom = Math.min(killFrom, frame + i);
          stopFrame = Math.min(stopFrame, killFrom + killLength);
        } else stopFrame = Math.min(stopFrame, frame + i);
        break;
      }
      const b = Math.max(a, Math.min(n, stopFrame - frame));
      if (!started) start(params, a);
      const { left, right, center } = scratch;
      left.fill(0, a, b);
      right.fill(0, a, b);
      center.fill(0, a, b);
      if (b > a) oscs.forEach((osc) => renderOsc(osc, params, a, b, left, right, center));
      outL.fill(0);
      outR.fill(0);
      for (let i = a; i < b; i++) {
        outL[i] = left[i] + center[i];
        outR[i] = right[i] + center[i];
      }
      // the fade of a stolen voice: from 1 at killFrom to 0 at the stop
      if (killFrom !== Infinity) {
        for (let i = Math.max(a, killFrom - frame); i < b; i++) {
          const gain = 1 - (frame + i - killFrom) / killLength;
          outL[i] *= gain;
          outR[i] *= gain;
        }
      }
      if (stopFrame - frame <= n) {
        end();
        return false;
      }
      return true;
    },
    // ends the voice at once (its process threw): the versions and the mixes it holds are given back
    end,
    get ended() {
      return ended;
    },
    // the frame the voice is scheduled at (options.start) and the one it started at (-1 before)
    startFrame,
    get startedAt() {
      return startedAt;
    },
  };
};
