import type { EnvelopeParams } from '../envelope/envelope-curve';
import type { WavetableLevels } from './wavetable-levels';

// the options of a voice of the wavetable oscillator (its node, processorOptions), the messages between the main
// thread, the store, the worker and the voices, the routes and the filter of a voice: the API of its Rust core
// (dsp/wavetable-osc, wavetable-osc-wasm.ts), no signal processing here

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
  // posts a VoiceStartedMessage once (the perf test hook times the notes)
  trace?: boolean;
}

// voice → main thread: the voice has ended, its node can be disconnected
export interface VoiceEndedMessage {
  ended: true;
}
// voice → main thread, once: the frame it was scheduled at and the one it started at (its first block: later
// when the node was created after its start). A traced voice tells it always, another one only when late (the
// fx and Poly follow it from its first sample)
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

// a route of a note: envelope `env` (0: ENV 1, 1: ENV 2, 2: ENV 3) moves `param` by amount × its level
// (0..1), in the units of the param (octaves for a log one: the base × 2^(amount × level)); the base plus
// every route is clamped to min..max, the range of the knob
export interface VoiceRoute {
  env: number;
  param: string;
  amount: number;
  min: number;
  max: number;
  log?: boolean;
}

// main thread → voice: the routes of a playing note changed (added, an amount, removed)
export interface VoiceRoutesMessage {
  routes: VoiceRoute[];
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

// main thread → voice: the knobs of the filter changed (null: turned off)
export interface VoiceFilterMessage {
  filter: VoiceFilterOptions | null;
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
