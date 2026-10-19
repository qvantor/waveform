import { coefficientsInto } from '@waveform/math/biquad';

// the filter of a voice in its processor (wavetable-osc-dsp.ts): after the sum of the oscillators, before the
// volume (ENV 1), so the envelopes of each note move its own filter. The coefficients are those of a
// BiquadFilterNode (biquad.coefficients of libs/math, as the chart of the filter): unmodulated it sounds as
// the native node did

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

// the params the routes of the filter move (voice-modulation.ts)
export type FilterParam = 'cutoff' | 'resonance' | 'gain';
type FilterValues = Record<FilterParam, Float32Array>;

// samples between the points the coefficients of a moving filter are worked out at
const SEGMENT = 32;
// seconds: the time constant a changed knob glides to its value with on a playing note (95% in 10 ms); the
// cutoff glides in octaves
const SMOOTHING = 0.0033;
// the render quantum, the buffers grow if a block is longer
const BLOCK = 128;

// a span s..e of both channels (the middle voices of the unison added into each) through the biquad
// (transposed direct form II, the state of the left channel at z[0..1], of the right one at z[2..3]), × the
// volume (`gains` per sample, or `gain`) into the outputs: one pass from the oscillators to the output
const filterSpan = (
  left: Float32Array,
  right: Float32Array,
  center: Float32Array,
  outL: Float32Array,
  outR: Float32Array,
  s: number,
  e: number,
  c: Float64Array,
  z: Float64Array,
  gains: Float32Array | null,
  gain: number
) => {
  const b0 = c[0];
  const b1 = c[1];
  const b2 = c[2];
  const a1 = c[3];
  const a2 = c[4];
  let z1l = z[0];
  let z2l = z[1];
  let z1r = z[2];
  let z2r = z[3];
  for (let i = s; i < e; i++) {
    const m = center[i];
    const xl = left[i] + m;
    const xr = right[i] + m;
    const yl = b0 * xl + z1l;
    z1l = b1 * xl - a1 * yl + z2l;
    z2l = b2 * xl - a2 * yl;
    const yr = b0 * xr + z1r;
    z1r = b1 * xr - a1 * yr + z2r;
    z2r = b2 * xr - a2 * yr;
    const g = gains === null ? gain : gains[i];
    outL[i] = yl * g;
    outR[i] = yr * g;
  }
  z[0] = z1l;
  z[1] = z2l;
  z[2] = z1r;
  z[3] = z2r;
};

// the filter of a voice: set() takes the knobs (a playing note glides to them), glide() works out the values of
// the knobs of a block (`bases`, the params the routes move: `moved` replaces them), process() filters both
// channels.
// While they are constant over the block (one value each) the coefficients are worked out once and only when
// one of them has changed; a moving one is read every SEGMENT samples. Off, nothing is computed
export const createVoiceFilter = (sampleRate: number, options: VoiceFilterOptions | null) => {
  // on: read every block, a field (not a getter)
  const flags = { on: false };
  let type: BiquadFilterType = 'lowpass';
  // the knobs now and the values they glide to: log2 of the cutoff, the resonance, the gain
  const values = new Float64Array(3);
  const targets = new Float64Array(3);
  // the knobs of the block (the bases of the routes): one value each, one per sample while one glides
  const still = [new Float32Array(1), new Float32Array(1), new Float32Array(1)];
  const gliding = [new Float32Array(BLOCK), new Float32Array(BLOCK), new Float32Array(BLOCK)];
  const bases: FilterValues = { cutoff: still[0], resonance: still[1], gain: still[2] };
  // the values the routes give the knobs instead (null: none)
  const moved: Record<FilterParam, Float32Array | null> = { cutoff: null, resonance: null, gain: null };
  // a knob at its target, as one value
  const settle = (k: number) => (still[k][0] = k === 0 ? 2 ** targets[k] : targets[k]);
  // the share of the way to the target a value glides per sample
  const step = 1 - Math.exp(-1 / (SMOOTHING * sampleRate));
  const coefficients = new Float64Array(5);
  // the values the coefficients are of
  const last = new Float64Array(3).fill(NaN);
  const params = { frequency: 0, Q: 0, gain: 0 };
  // the state of the left and the right channel
  const state = new Float64Array(4);

  const set = (next: VoiceFilterOptions | null, glide: boolean) => {
    if (!next) {
      flags.on = false;
      return;
    }
    targets[0] = Math.log2(Math.max(1e-3, next.cutoff));
    targets[1] = next.resonance;
    targets[2] = next.gain;
    if (next.type !== type) last.fill(NaN);
    type = next.type;
    // a filter turned on starts at its knobs from silence
    if (!glide || !flags.on) {
      values.set(targets);
      for (let k = 0; k < 3; k++) settle(k);
      state.fill(0);
      last.fill(NaN);
    }
    flags.on = true;
  };
  set(options, false);

  return Object.assign(flags, {
    set: (next: VoiceFilterOptions | null) => set(next, true),
    bases,
    moved,
    // the knobs of a block of n samples into `bases`: one value each at its target, one per sample while it
    // glides to it
    glide: (n: number) => {
      for (let k = 0; k < 3; k++) {
        let value = values[k];
        const target = targets[k];
        let out = still[k];
        if (value !== target) {
          if (gliding[k].length !== n) gliding[k] = new Float32Array(n);
          out = gliding[k];
          for (let i = 0; i < n; i++) {
            value += (target - value) * step;
            out[i] = k === 0 ? 2 ** value : value;
          }
          values[k] = Math.abs(target - value) <= Math.abs(target) * 1e-6 + 1e-9 ? target : value;
          if (values[k] === target) settle(k);
        }
        if (k === 0) bases.cutoff = out;
        else if (k === 1) bases.resonance = out;
        else bases.gain = out;
      }
    },
    // the channels of the voice over a..b (the middle voices of the unison added into both) into the outputs, ×
    // the volume (`gains` per sample, or `volume`): the knobs, those the routes move replaced (one value or one
    // per sample)
    process: (
      left: Float32Array,
      right: Float32Array,
      center: Float32Array,
      outL: Float32Array,
      outR: Float32Array,
      a: number,
      b: number,
      gains: Float32Array | null,
      volume: number
    ) => {
      if (!flags.on) return;
      const cutoff = moved.cutoff ?? bases.cutoff;
      const resonance = moved.resonance ?? bases.resonance;
      const gain = moved.gain ?? bases.gain;
      const moving = cutoff.length > 1 || resonance.length > 1 || gain.length > 1;
      for (let s = a; s < b; ) {
        const e = moving ? Math.min(b, s + SEGMENT) : b;
        const f = cutoff.length > 1 ? cutoff[s] : cutoff[0];
        const q = resonance.length > 1 ? resonance[s] : resonance[0];
        const g = gain.length > 1 ? gain[s] : gain[0];
        if (f !== last[0] || q !== last[1] || g !== last[2]) {
          params.frequency = f;
          params.Q = q;
          params.gain = g;
          coefficientsInto(coefficients, type, params, sampleRate);
          last[0] = f;
          last[1] = q;
          last[2] = g;
        }
        filterSpan(left, right, center, outL, outR, s, e, coefficients, state, gains, volume);
        s = e;
      }
    },
  });
};
