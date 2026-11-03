import { createHash } from 'crypto';
import { presetHash } from './hash';
import { fxSnapSchema, PRESET_DEFAULTS } from './schema';

// The hashes of the presets are their identity in the database (dedup by hash): a change of a library under the
// schema (zod, @noble/hashes) or of the schema itself must not change them silently. Recorded on zod 3 and
// @noble/hashes 1; a change of the sound of a preset is an explicit update of these values.

const FULL = {
  name: 'Not a part of the hash',
  osc1: {
    a: true,
    p: ['A', 'B', 'A/B/c.wav'],
    w: 3.5,
    o: -1,
    s: 7,
    f: -12,
    d: 12.5,
    u: 4,
    b: 0.3,
    ph: 0.25,
    pr: 0.5,
    g: 0.7,
  },
  osc2: {
    a: true,
    p: ['Basic', 'saw.wav'],
    w: 255,
    o: 1,
    s: -24,
    f: 100,
    d: 0,
    u: 8,
    b: 1,
    ph: 0,
    pr: 0,
    g: 0.5,
  },
  filter: { a: true, t: 'bandpass', cut: 1234.5678, res: 2, gain: -3 },
  env: {
    e1: {
      attack: 0.01,
      hold: 0,
      decay: 1.5,
      sustain: 0.8,
      release: 0.4,
      curves: { attack: -2.5, decay: 0, release: 7 },
      bpm: true,
      divs: { attack: 43, hold: 0, decay: 20, release: 9 },
    },
    e2: { attack: 0.005, hold: 0.2, decay: 32, sustain: 0, release: 0, curves: { decay: 1e-17 } },
    e3: { attack: 2, hold: 0, decay: 0.5, sustain: 0.25, release: 0.3 },
    vel: { amp: 0.4, k: -3 },
  },
  lfo: {
    l1: {
      rate: 0.25,
      delay: 0.1,
      rise: 0.5,
      smooth: 0.01,
      phase: 0.75,
      bpm: true,
      div: 20,
      trip: true,
      dot: false,
      host: false,
      delayDiv: 5,
      riseDiv: 6,
    },
    l2: {
      points: [
        [0, 0, 0],
        [0.25, 1, 3],
        [0.25, 0.5, -2],
        [1, 0, 0],
      ],
    },
    l3: { rate: 4, phase: 0.1 },
  },
  mod: {
    'env2:osc1.wave': 0.5,
    'velo:filter.cutoff': -0.25,
    'lfo1:filter.gain': { a: 0.5, bi: true },
    'lfo2:osc2.pitch': { a: -0.3, off: true },
    'env3:delay.time': { a: 0.2, bi: true, off: true },
    'env1:lfo1.rate': 0.1,
  },
  v: { leg: true, port: 0.12, max: 1, bd: 12, bu: 0 },
  fx: {
    o: ['reverb', 'distortion'],
    distortion: { a: true, on: false, mix: 0.6, mode: 1, drive: 4, tone: 8000, level: -6 },
    delay: {
      a: true,
      on: true,
      mix: 0.5,
      time: 0.25,
      sync: 1,
      div: 37,
      trip: 0,
      dot: 1,
      fb: 0.3,
      mode: 1,
      pan: -0.01,
      freq: 800,
      q: 2,
    },
    reverb: {
      a: true,
      on: true,
      mix: 0.3,
      lowcut: 80,
      pre: 0.01,
      size: 0.4,
      decay: 1.5,
      damp: 5000,
      bass: 1.2,
      depth: 0.2,
      sep: 1,
      er: 0.5,
      era: 2,
    },
  },
};

const PRESETS: Record<string, unknown> = {
  // Init
  empty: {},
  full: FULL,
  // saved before Phase and Phase rand: a start delay r of 0..2 ms, the old adsr, no Semi, Fine, blend, LFOs
  legacy: {
    osc1: { a: true, p: ['A', 'B', 'A/B/c.wav'], w: 2, o: 0, d: 10, u: 3, r: 0.001, g: 0.6 },
    osc2: { r: 0.0015, ph: 0.3 },
    adsr: { attack: 0.5 },
    filter: { a: false, t: 'lowpass', cut: 440, res: 0, gain: 1 },
    mod: { 'env2:osc1.wave': 1 },
  },
  // nested sections given in part: their defaults fill the rest
  partial: {
    osc2: { a: true },
    env: { e2: { decay: 1 } },
    lfo: { l4: { shape: 'triangle' } },
    fx: { o: ['delay'], delay: { a: true } },
  },
  // an order saved before the distortion: it goes to its default place
  'fx order without a type': { fx: { o: ['reverb', 'delay'], reverb: { a: true } } },
};

const PRESET_HASHES: Record<string, string> = {
  empty: '5e61ce1a7b7f4014cca765bf84952ce39d9830e76b6b312226e6e1f60b88845e',
  full: '089a0db8449ac4efdb7ebabcfe81c63cc0d28b65d2cfbd197de2f0a43c11b0ea',
  legacy: '636e0845ae8a63df5e6bdbbcc4711184243506ee16de7baf7f01f5362e2ae143',
  partial: 'eba9735d3fe11d00eff6d0220a1d2570c099701ae8846ce17f531b9df68595fe',
  'fx order without a type': '21177c11d521ded180733f986d86d0362db04092ed36d225cca4c66aafef6828',
};

// not presets: the schema rejects them
const INVALID: Record<string, unknown> = {
  null: null,
  'a fractional unison': { osc1: { u: 1.5 } },
  'an infinite position': { osc1: { w: Infinity } },
  'no wavetable path': { osc1: { p: [] } },
  'an unknown filter type': { filter: { t: 'comb' } },
  'an LFO on the knob of an LFO': { mod: { 'lfo1:lfo2.rate': 0.5 } },
  'a route object without a flag': { mod: { 'env1:osc1.wave': { a: 0.5 } } },
  'five sources on a knob': {
    mod: {
      'env1:osc1.wave': 0.1,
      'env2:osc1.wave': 0.1,
      'env3:osc1.wave': 0.1,
      'velo:osc1.wave': 0.1,
      'lfo1:osc1.wave': 0.1,
    },
  },
  'LFO points that start past 0': {
    lfo: {
      l1: {
        points: [
          [0.1, 0, 0],
          [1, 1, 0],
        ],
      },
    },
  },
  'an fx order that is not a list': { fx: { o: 'reverb' } },
};

// the url snapshot of the fx: never fails, invalid values fall back to the defaults
const FX_SNAPS: Record<string, unknown> = {
  null: null,
  garbage: { o: 'reverb', delay: { time: 'abc', fb: 5, div: 3.6 }, reverb: { era: 1.6, a: 'yes' }, x: 1 },
  full: FULL.fx,
};

const FX_SNAP_HASHES: Record<string, string> = {
  null: 'f617937957dacfb0b2715c7f68ed1373859112e750776199f476d3108f00767b',
  garbage: 'c63e1881c95a996f29e243c70c46daad4cb0b972178e0dc8169e2e4194409f76',
  full: '2133ceaf184887400ca3786b80e2db366fe28db0af77ee1d1cface63eae4cf1c',
};

// key order aside: the values of the output
const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable((value as Record<string, unknown>)[key])])
    );
  return value;
};
const hashOf = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(stable(value)))
    .digest('hex');

describe('the hashes of presets', () => {
  it.each(Object.keys(PRESETS))('%s', (name) => {
    expect(presetHash(PRESETS[name])).toBe(PRESET_HASHES[name]);
  });

  it('Init is the defaults of every knob', () => {
    expect(hashOf(PRESET_DEFAULTS)).toBe(PRESET_HASHES['empty']);
  });

  it.each(Object.keys(INVALID))('rejects %s', (name) => {
    expect(() => presetHash(INVALID[name])).toThrow();
  });
});

describe('the url snapshot of the fx', () => {
  it.each(Object.keys(FX_SNAPS))('%s', (name) => {
    expect(hashOf(fxSnapSchema.parse(FX_SNAPS[name]))).toBe(FX_SNAP_HASHES[name]);
  });
});
