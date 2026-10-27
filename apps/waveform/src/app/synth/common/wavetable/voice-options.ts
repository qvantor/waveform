import type { EnvelopeParams } from '../envelope/envelope-curve';
import type { LfosState } from '../lfo/lfo-curve';
import type { WavetableLevels } from './wavetable-levels';
import type { VoiceParam } from './wavetable-osc-params';

// the options of a voice of the wavetable oscillator (its note on, an event to the voices node), the messages
// between the main thread, the store, the worker and the voices node, the routes and the filter of a voice: the
// API of its Rust core (dsp/wavetable-osc, wavetable-osc-wasm.ts), no signal processing here

// an oscillator of a voice, null in VoiceOptions.osc: off for the note
export interface VoiceOscOptions {
  // the table in the store, a voice plays its latest version
  table: string;
  // voices 1..8, detune 0 (spread at the start of the note) plays one
  unison: number;
  // shares of a period: the start phase of every unison voice and the most of its random shift (1: any phase)
  phase: number;
  phaseRand: number;
  // how its unison voices sound, UNISON_SHAPE without it
  unisonShape?: UnisonShape;
}

// the stacks of a unison (12 (1x, 2x, 3x), 12+7 (1x, 2x, 3x), Center-12, Center-24; the measurements in
// dsp/measurements): voice j of n at d = j - floor(n/2) from the middle; the centre (the middle one of an
// odd count, the middle two of an even one) moves only by the centre stacks, a single voice too; the others by
// a = |d|: 12 (kx) up 12·(a mod (k + 1)), 12+7 (kx) up 7 at a mod 4 = 2 and 12 ((k - 1)x). A voice of an even
// count and its mirror move apart (d and -d - 1)
export const UNISON_STACKS = [
  'off',
  '12x1',
  '12x2',
  '12x3',
  '12+7x1',
  '12+7x2',
  '12+7x3',
  'center-12',
  'center-24',
] as const;
export type UnisonStack = typeof UNISON_STACKS[number];

// how the voices share the spread (dsp/measurements/unison.json): of x = 2j/(n - 1) - 1 from the lowest,
// x (linear), tan(x)/tan(1) (super: the inner voices closer), x·|x| (exp: closer still), sin(x·π/2) (inv: out to the
// edges), or at random shares of it, drawn again at every note on
export const UNISON_DETUNES = ['linear', 'super', 'exp', 'inv', 'random'] as const;
export type UnisonDetune = typeof UNISON_DETUNES[number];

// the unison of an oscillator (in the engine: no knobs, not in the presets yet; a type: an ObjectBS
// holds it)
export type UnisonShape = {
  // the level of the centre voices against the others: 0 only the centre, 0.5 all at one level, 1 only the others;
  // the power of the unison stays
  blend: number;
  // the stereo of the side voices: 1 hard left and right in turn, 0 mono (equal power: as loud)
  width: number;
  stack: UnisonStack;
  detune: UnisonDetune;
  // the voices play positions spread over this share of the table (0..1) as they are spread in pitch: the lowest
  // at the position - half of it, the highest + half (within the table)
  positionSpread: number;
};

// the unison as it was before its shape: the same sound bit for bit
export const UNISON_SHAPE: UnisonShape = {
  blend: 0.5,
  width: 1,
  stack: 'off',
  detune: 'linear',
  positionSpread: 0,
};

// the velocity of a note: the level of VELO (the curve of its velocity: a source of the routes, after the
// envelopes) and its amp (its volume after ENV 1: 1 - Amp + Amp · level)
export interface VoiceVelocity {
  level: number;
  amp: number;
}

export interface VoiceOptions {
  osc: (VoiceOscOptions | null)[];
  // seconds of the context time the note starts at
  start: number;
  // ENV 1–3 as they were at the note on (ENV 1 is the volume of the note) and the seconds of the context
  // time they start at: the note on, in legato the start of the phrase (they don't start again)
  envelopes: EnvelopeParams[];
  envStart: number;
  // the phrase of the note, a number of the main thread unique in the context: the notes of a legato phrase
  // share it (and its envelopes), a note on starts one of its own
  phrase: number;
  // the envelopes move these params (VoiceRoute), changed on a playing note by a message
  routes: VoiceRoute[];
  // the filter after the oscillators, null: off; its knobs change by a message
  filter: VoiceFilterOptions | null;
  // its velocity (none: no VELO, the amp 1); a note that takes the voice over (mono) changes it by a message
  velocity?: VoiceVelocity;
  // the voices node tells its start (VoiceStartedMessage) once (the perf test hook times the notes)
  trace?: boolean;
  // a voice of mono (Poly 1): the notes it takes over may start its envelopes again, the voices node tells its
  // start once, on time too
  mono?: boolean;
}

// main thread → voices processor, the events of a task in the order they were made: a voice of a note (`on`), the
// automation of its params (the AudioParam call of the same name: setValueAtTime, setTargetAtTime,
// exponentialRampToValueAtTime, cancelScheduledValues, linearRampToValueAtTime (the synth makes none); values in
// f32, times in seconds of the context), the routes, the filter and the velocity of playing voices, and the pitch
// bend of the node. An event of a voice that has ended changes nothing
export interface VoiceOn {
  kind: 'on';
  voice: number;
  options: VoiceOptions;
  // the values of its params at the note on (a param left out: the default of its descriptor)
  params: Partial<Record<VoiceParam, number>>;
}
export interface VoiceAutomation {
  kind: 'set' | 'target' | 'ramp' | 'cancel' | 'linear';
  voice: number;
  param: VoiceParam;
  time: number;
  // (none for cancel)
  value?: number;
  // the time constant of a target
  constant?: number;
}
export interface VoicesRoutes {
  kind: 'routes';
  voices: number[];
  routes: VoiceRoute[];
}
export interface VoicesFilter {
  kind: 'filter';
  voices: number[];
  filter: VoiceFilterOptions | null;
}
// a note took the voice over (mono): its VELO and its amp glide to its velocity in 10 ms
export interface VoicesVelocity {
  kind: 'velocity';
  voices: number[];
  velocity: VoiceVelocity;
}
// the pitch bend of every voice of the node (cents on top of the detune of each oscillator): it glides there in
// 10 ms, new voices start with it; `instantly` it is there (a node made again)
export interface VoicesBend {
  kind: 'bend';
  cents: number;
  instantly?: boolean;
}
// the LFOs of every voice of the node from `at` on (their knobs, clocks and shapes: lfo-curve.ts), in the order of
// the other events (a voice made after it plays them)
export interface VoicesLfos extends LfosState {
  kind: 'lfos';
}
export type VoiceEvent =
  | VoiceOn
  | VoiceAutomation
  | VoicesRoutes
  | VoicesFilter
  | VoicesVelocity
  | VoicesBend
  | VoicesLfos;
export interface VoiceEventsMessage {
  events: VoiceEvent[];
}

// voices processor → main thread, after a block that has any: the voices that started (late, of mono, traced: its
// id, the frame it started at and the one it was scheduled at, once) and those that ended (released to 0, stolen,
// or failed)
export interface VoicesReportMessage {
  started?: [number, number, number][];
  ended?: number[];
}

// the start of a voice the voices node tells, once: the frame it was scheduled at and the one it started at (its
// first block: later when its note on came after its start). A traced voice and a voice of mono tell it always
// (the main thread keeps the starts again of mono until then), another one only when late (the fx and Poly follow
// it from its first sample)
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
// the voices of the node of the voices and the automation events their timelines hold
export interface VoiceScopeStats {
  scopeVoices: number;
  events: number;
}
// store → main thread: the answer to a StatsRequest, at the frame it was read
export interface StoreStatsMessage {
  stats: TableStoreStats & VoiceStats & VoiceScopeStats & { frame: number };
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

// a route of a note: `source` (0: ENV 1, 1: ENV 2, 2: ENV 3, 3: VELO, the velocity after the envelopes, 4–7: LFO
// 1–4; MOD_SOURCES.indexOf) moves `param` (a param of the voice, 'cutoff'…, or a knob of an LFO, 'lfo2.rate': no
// LFO goes there) by amount × its level (0..1; bipolar: amount × (level - ½)), in the units of the param in its
// scale: linear, log (octaves: the base × 2^(amount × level)), pow (a share of the travel of the knob, max ·
// share⁴: the times of the LFOs); the base plus every route is clamped to min..max, the range of the knob (the
// Phase of an LFO goes around the cycle: not clamped). Rate of an LFO is its frequency (Hz, 1 / the period)
export type VoiceRouteScale = 'linear' | 'log' | 'pow';
export interface VoiceRoute {
  source: number;
  param: string;
  amount: number;
  min: number;
  max: number;
  scale?: VoiceRouteScale;
  bipolar?: boolean;
}

// store → main thread: a version is in the store, new voices play it
export interface StoreStoredMessage {
  stored: string;
  version: number;
}

// the knobs of the filter (the filter model), null: off
export interface VoiceFilterOptions {
  type: BiquadFilterType;
  // Hz, Q (dB for lowpass and highpass), dB
  cutoff: number;
  resonance: number;
  gain: number;
}

// seconds: the fade-out of a stolen voice, the crossfade into a new version of the table (a note of a legato phrase
// fades in over 1.5 ms). The fade-out is a raised cosine over more than a period of a bass note (C2: 15 ms): a
// stolen pad still sounds, a linear 5 ms clicked (its splatter ~35 dB above this one's)
export const KILL_FADE = 0.02;
export const CROSSFADE = 0.01;

// the length of the tables of a browser's PeriodicWave at the rate (Chrome and WebKit: 2048 up to 24 kHz, 4096
// up to 88.2 kHz, 16384 above), its oscillator reads them linearly: a mix table as long has the same aliasing
export const nativeTableLength = (sampleRate: number) =>
  sampleRate <= 24000 ? 2048 : sampleRate <= 88200 ? 4096 : 16384;

// the points of the interpolation that brings a shorter level to the length of a mix
export const UPSAMPLER_TAPS = 6;
