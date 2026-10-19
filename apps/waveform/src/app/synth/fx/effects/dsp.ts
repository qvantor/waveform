import { biquad } from '@waveform/math';

// sample-by-sample building blocks of the audio worklets: no Web Audio nodes, so loops are exact
// (a node cycle is rendered at least a 128-frame quantum late) and the state can be tested offline

// a ring buffer holding at least `maxDelay` samples; read before write: read(d) is the sample written
// d steps ago (d >= 2), fractional delays are interpolated with a 4-point cubic hermite: linear
// interpolation dulls the highs a little on every read, which a feedback loop adds up into a shorter
// decay of the highs, the more the shorter the loop is
export const createDelayLine = (maxDelay: number) => {
  const size = 2 ** Math.ceil(Math.log2(maxDelay + 4));
  const mask = size - 1;
  const buffer = new Float64Array(size);
  let index = 0;
  return {
    read: (delay: number) => {
      const pos = index - Math.max(2, delay);
      const i = Math.floor(pos);
      const t = pos - i;
      const prev = buffer[(i - 1) & mask];
      const x0 = buffer[i & mask];
      const x1 = buffer[(i + 1) & mask];
      const next = buffer[(i + 2) & mask];
      const c1 = 0.5 * (x1 - prev);
      const c2 = prev - 2.5 * x0 + 2 * x1 - 0.5 * next;
      const c3 = 0.5 * (next - prev) + 1.5 * (x0 - x1);
      return ((c3 * t + c2) * t + c1) * t + x0;
    },
    write: (value: number) => {
      buffer[index] = value;
      index = (index + 1) & mask;
    },
    clear: () => buffer.fill(0),
  };
};

// Schroeder allpass: v = x + g·v[n-d], y = v[n-d] - g·v; flat magnitude, only the phase is smeared
export const createAllpass = (maxDelay: number) => {
  const line = createDelayLine(maxDelay);
  return {
    process: (input: number, delay: number, gain: number) => {
      const delayed = line.read(delay);
      const sum = input + gain * delayed;
      line.write(sum);
      return delayed - gain * sum;
    },
    clear: line.clear,
  };
};

// an allpass of a fixed delay, rounded to whole samples: read without interpolation, it costs a
// fraction of the gliding one
export const createFixedAllpass = (delay: number) => {
  const buffer = new Float64Array(Math.max(1, Math.round(delay)));
  let index = 0;
  return {
    process: (input: number, gain: number) => {
      const delayed = buffer[index];
      const sum = input + gain * delayed;
      buffer[index] = sum;
      index = index + 1 === buffer.length ? 0 : index + 1;
      return delayed - gain * sum;
    },
    clear: () => buffer.fill(0),
  };
};

// butterworth: Q of highpass and lowpass is in dB
export const BUTTERWORTH_Q = -3.01;

// transposed direct form II, the coefficients are the BiquadFilterNode ones (biquad.coefficients); the state
// is in a typed array, so writing it boxes no number
export const createBiquad = () => {
  let [b0, b1, b2, a1, a2] = [1, 0, 0, 0, 0];
  const z = new Float64Array(2);
  return {
    set: (type: BiquadFilterType, params: biquad.BiquadParams, sampleRate: number) => {
      [b0, b1, b2, a1, a2] = biquad.coefficients(type, params, sampleRate);
    },
    process: (input: number) => {
      const output = b0 * input + z[0];
      z[0] = b1 * input - a1 * output + z[1];
      z[1] = b2 * input - a2 * output;
      return output;
    },
    // a block: output[s] of input[s] for s < frames, the same as process() sample by sample
    processBlock: (input: Float64Array, output: Float64Array, frames: number) => {
      let z1 = z[0];
      let z2 = z[1];
      for (let s = 0; s < frames; s++) {
        const x = input[s];
        const y = b0 * x + z1;
        z1 = b1 * x - a1 * y + z2;
        z2 = b2 * x - a2 * y;
        output[s] = y;
      }
      z[0] = z1;
      z[1] = z2;
    },
    clear: () => z.fill(0),
  };
};

// one pole highpass that takes the DC out: y = x - x[n-1] + r·y[n-1], r from the cutoff (Hz). Cut at a few
// Hz it leaves the bass alone (5 Hz: -0.12 dB at 30 Hz), but its tail is long: τ = 1 / (2π·cutoff)
export const createDcBlocker = (cutoff: number, sampleRate: number) => {
  const r = Math.exp((-2 * Math.PI * cutoff) / sampleRate);
  // the last input and output, in a typed array, so writing them boxes no number
  const state = new Float64Array(2);
  return {
    // data[0..frames) in place
    processBlock: (data: Float64Array, frames: number) => {
      let x1 = state[0];
      let y1 = state[1];
      for (let s = 0; s < frames; s++) {
        const x = data[s];
        y1 = x - x1 + r * y1;
        x1 = x;
        data[s] = y1;
      }
      state[0] = x1;
      state[1] = y1;
    },
    clear: () => state.fill(0),
  };
};

export type Smoothed = ReturnType<typeof createSmoothed>;

// a param that glides to its target with a time constant, stepped once per block; `from` is the value
// at the start of the block, so delay lengths can be interpolated per sample instead of jumping
export const createSmoothed = (initial: number, timeConstant: number, sampleRate: number) => {
  let target = initial;
  let glide = timeConstant;
  const state = { from: initial, value: initial };
  return Object.assign(state, {
    // the first value is applied instantly, like a param set before the effect is heard; `seconds`: the time
    // constant of this glide (the one of the param by default)
    set: (value: number, instant = false, seconds = timeConstant) => {
      target = value;
      glide = seconds;
      if (instant) [state.from, state.value] = [value, value];
    },
    // jumps to the target
    snap: () => {
      [state.from, state.value] = [target, target];
    },
    // true while gliding
    step: (frames: number): boolean => {
      state.from = state.value;
      if (state.value === target) return false;
      state.value += (target - state.value) * (1 - Math.exp(-frames / (glide * sampleRate)));
      if (Math.abs(target - state.value) <= Math.abs(target) * 1e-6 + 1e-9) state.value = target;
      return true;
    },
  });
};

// steps every value once per block (a loop, so a block allocates nothing); true if any of them glides
export const stepAll = (values: Smoothed[], frames: number) => {
  let gliding = false;
  for (let i = 0; i < values.length; i++) gliding = values[i].step(frames) || gliding;
  return gliding;
};

// the loudest sample of a block
export const peak = (data: Float32Array) => {
  let max = 0;
  for (let i = 0; i < data.length; i++) max = Math.max(max, Math.abs(data[i]));
  return max;
};
