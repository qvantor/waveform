import { coefficients } from '@waveform/math/biquad';
import { wasmCore } from '../../../../test-utils/wasm';
import { CEILING, CEILING_DB, LOOKAHEAD, TRUE_PEAK_DELAY } from './limiter-params';
import { createLimiterWasm, LimiterExports } from './limiter-wasm';

const SAMPLE_RATE = 48000;
const BLOCK = 128;
// the largest sample a Float32Array output can hold at the ceiling
const MAX_SAMPLE = Math.fround(CEILING);

const db = (gain: number) => 20 * Math.log10(gain);

type Input = (frame: number, channel: number) => number;

type CreateLimiter = (
  sampleRate: number
) => Pick<ReturnType<typeof createLimiterWasm>, 'process' | 'latency'>;

// the Rust core (dsp/limiter), one instance of it for the spec (a scope)
const core = wasmCore<LimiterExports>('limiter');
const createLimiter: CreateLimiter = (sampleRate) => createLimiterWasm(core, sampleRate);

// renders in render quanta like the worklet
const render = (
  input: Input,
  seconds: number,
  sampleRate = SAMPLE_RATE,
  create: CreateLimiter = createLimiter
) => {
  const dsp = create(sampleRate);
  const frames = Math.ceil((seconds * sampleRate) / BLOCK) * BLOCK;
  const inputs = [0, 1].map((channel) => Float32Array.from({ length: frames }, (_, i) => input(i, channel)));
  const [L, R] = [new Float32Array(frames), new Float32Array(frames)];
  for (let start = 0; start < frames; start += BLOCK) {
    const block = (data: Float32Array) => data.subarray(start, start + BLOCK);
    dsp.process(block(inputs[0]), block(inputs[1]), block(L), block(R));
  }
  const { latency } = dsp;
  // the gain the limiter applied at an output frame (NaN where the input is too quiet to tell)
  const gain = (frame: number, channel = 0) => {
    const dry = inputs[channel][frame - latency];
    return Math.abs(dry) > 0.05 ? (channel ? R : L)[frame] / dry : NaN;
  };
  return { L, R, inputs, latency, gain };
};

const frame = (seconds: number) => Math.round(seconds * SAMPLE_RATE);

const samplePeak = (data: Float32Array) => data.reduce((max, value) => Math.max(max, Math.abs(value)), 0);

// the true peak (dBTP) of what a DAC reconstructs: 16× with a long windowed sinc, independent of the
// 4× detector of the limiter
const REFERENCE_TAPS = 64;
const REFERENCE_PHASES = Array.from({ length: 15 }, (_, p) =>
  Float64Array.from({ length: 2 * REFERENCE_TAPS }, (_, j) => {
    const x = (p + 1) / 16 - (j + 1 - REFERENCE_TAPS);
    const window = 0.5 + 0.5 * Math.cos((Math.PI * x) / REFERENCE_TAPS);
    return (Math.sin(Math.PI * x) / (Math.PI * x)) * window;
  })
);
const truePeakDb = (data: Float32Array) => {
  let peak = samplePeak(data);
  for (let n = REFERENCE_TAPS; n < data.length - REFERENCE_TAPS; n++) {
    const first = n + 1 - REFERENCE_TAPS;
    for (const taps of REFERENCE_PHASES) {
      let value = 0;
      for (let j = 0; j < taps.length; j++) value += data[first + j] * taps[j];
      peak = Math.max(peak, Math.abs(value));
    }
  }
  return db(peak);
};

// the gain range (dB) between two times, where the input is loud enough to tell
const gainRange = (gain: (frame: number) => number, from: number, to: number) => {
  const gains = [];
  for (let n = frame(from); n < frame(to); n++) if (!Number.isNaN(gain(n))) gains.push(db(gain(n)));
  return { min: Math.min(...gains), max: Math.max(...gains) };
};

// deterministic white noise
const createNoise = () => {
  let seed = 1;
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647) * 2 - 1;
  };
};

const sine =
  (freq: number, amplitude: number, from = 0): Input =>
  (n) =>
    n >= from ? amplitude * Math.sin((2 * Math.PI * freq * n) / SAMPLE_RATE) : 0;

// a band-limited saw like a PeriodicWave plays it: one cycle summed from the partials below nyquist
// (sin(k·angle) by the chebyshev recurrence), read with linear interpolation at any detune and phase
const createSaw = (freq: number) => {
  const size = 4096;
  const cycle = new Float64Array(size + 1);
  for (let i = 0; i <= size; i++) {
    const angle = (2 * Math.PI * i) / size;
    const twoCos = 2 * Math.cos(angle);
    let [prev, current] = [0, Math.sin(angle)];
    for (let k = 1; k * freq < SAMPLE_RATE / 2; k++) {
      cycle[i] += (current / k) * (2 / Math.PI);
      [prev, current] = [current, twoCos * current - prev];
    }
  }
  return (n: number, detune = 1, phase = 0) => {
    const position = ((((freq * detune * n) / SAMPLE_RATE + phase) % 1) + 1) % 1;
    const i = Math.floor(position * size);
    return cycle[i] + (cycle[i + 1] - cycle[i]) * (position * size - i);
  };
};

const CHORD = [110, 138.6, 164.8, 220].map(createSaw);
const DETUNES = [-0.3, -0.1, 0.1, 0.3];

// a dense unison chord struck at once, about 16 dB over full scale; the sides are detuned apart
const unisonChord: Input = (n, channel) => {
  if (n < frame(0.05)) return 0;
  let value = 0;
  CHORD.forEach((saw) =>
    DETUNES.forEach((detune) => {
      value += saw(n, 1 + detune / 100, (channel + detune) / 7);
    })
  );
  return value / 2;
};

// noise low passed at 18 kHz, like the content of a sound: 4 butterworth sections
const bandNoise = (amplitude: number): Input => {
  const random = createNoise();
  const filters = [0, 1, 2, 3].map(() => {
    const [b0, b1, b2, a1, a2] = coefficients(
      'lowpass',
      { frequency: 18000, Q: -3.01, gain: 0 },
      SAMPLE_RATE
    );
    let [z1, z2] = [0, 0];
    return {
      process: (x: number) => {
        const y = b0 * x + z1;
        z1 = b1 * x - a1 * y + z2;
        z2 = b2 * x - a2 * y;
        return y;
      },
    };
  });
  const values: number[] = [];
  return (n) => {
    while (values.length <= n)
      values.push(filters.reduce((value, filter) => filter.process(value), random()));
    return amplitude * values[n];
  };
};

describe('the limiter', () => {
  const create = createLimiter;
  const renderCore = (input: Input, seconds: number, sampleRate = SAMPLE_RATE) =>
    render(input, seconds, sampleRate, create);

  it.each([
    [44100, 88],
    [48000, 96],
    [96000, 192],
  ])('at %s Hz delays the sound by the lookahead (%s frames) and the detector', (sampleRate, lookahead) => {
    expect(Math.round(LOOKAHEAD * sampleRate)).toBe(lookahead);
    expect(create(sampleRate).latency).toBe(lookahead + TRUE_PEAK_DELAY);
  });

  it('passes a sound below the ceiling bit for bit, only delayed', () => {
    // a chord of saws with its true peak 1.5 dB below the ceiling
    const [a, e, a2] = [220, 330, 440].map(createSaw);
    const chord: Input = (n) => (a(n) + e(n, 1, 0.2) + a2(n, 1, 0.4)) / 3.6;
    const { L, R, inputs, latency } = renderCore(chord, 0.3);
    expect(truePeakDb(inputs[0])).toBeLessThan(CEILING_DB - 1);
    expect(L.subarray(0, latency)).toEqual(new Float32Array(latency));
    expect(L.subarray(latency)).toEqual(inputs[0].subarray(0, L.length - latency));
    expect(R.subarray(latency)).toEqual(inputs[1].subarray(0, R.length - latency));
  });

  describe('never lets a sample over the ceiling', () => {
    const noise = createNoise();
    it.each<[string, Input]>([
      ['a single sample 20 dB over full scale', (n) => (n === frame(0.1) ? 10 : 0)],
      ['a square wave 12 dB over', (n) => (Math.floor(n / 50) % 2 ? 4 : -4)],
      ['white noise 12 dB over, different on each side', () => 4 * noise()],
      ['a dense unison chord struck at once', unisonChord],
      ['a sine at 0.45·fs 10 dB over', (n) => 3 * Math.sin(2 * Math.PI * 0.45 * n + 0.3)],
      ['a sine 12 dB over after silence', sine(1000, 4, frame(0.1))],
    ])('%s', (_, input) => {
      [44100, 48000].forEach((sampleRate) => {
        const { L, R } = renderCore(input, 0.3, sampleRate);
        expect(samplePeak(L)).toBeLessThanOrEqual(MAX_SAMPLE);
        expect(samplePeak(R)).toBeLessThanOrEqual(MAX_SAMPLE);
        // it is limiting, not muting
        expect(samplePeak(L)).toBeGreaterThan(CEILING / 2);
      });
    });
  });

  // between the samples the 4× detector reads a peak at most cos(π·f/4) low (0.55 dB at 0.45·fs): high
  // partials can go a little over the ceiling, never over full scale
  describe('keeps the true peak of a sound below full scale', () => {
    const saw3k = createSaw(3000);
    it.each<[string, Input, number]>([
      ['a dense unison chord struck at once', unisonChord, 0.1],
      ['noise 18 dB over, low passed at 18 kHz', bandNoise(8), 0.2],
      ['a 3 kHz saw 12 dB over after silence', (n) => (n >= frame(0.05) ? 4 * saw3k(n) : 0), 0.1],
      ['a 20 kHz sine 10 dB over', sine(20000, 3), 0.4],
      ['a sine at 0.45·fs 10 dB over', (n) => 3 * Math.sin(2 * Math.PI * 0.45 * n + 0.3), 0.5],
    ])('%s', (_, input, error) => {
      const { L, R } = renderCore(input, 0.2);
      [L, R].forEach((data) => {
        const peak = truePeakDb(data);
        expect(peak).toBeLessThan(0);
        expect(peak).toBeLessThan(CEILING_DB + error);
        // as loud as it can be
        expect(peak).toBeGreaterThan(CEILING_DB - 0.5);
      });
    });
  });

  it.each([30, 50, 1000, 5000])(
    'holds a steady tone 12 dB over at the ceiling, the gain does not move inside the %s Hz wave',
    (freq) => {
      const { L, gain } = renderCore(sine(freq, 4), 0.6);
      const { min, max } = gainRange(gain, 0.05, 0.6);
      expect(max - min).toBeLessThan(0.001);
      expect(max).toBeCloseTo(CEILING_DB - db(4), 1);
      expect(samplePeak(L)).toBeLessThanOrEqual(MAX_SAMPLE);
    }
  );

  it('turns the gain down along an S-curve over the lookahead before a peak, no step', () => {
    // a quiet constant, then 12 dB over
    const step = frame(0.1);
    const { gain, latency } = renderCore((n) => (n < step ? 0.1 : 4), 0.2);
    const onset = step + latency;
    const lookahead = latency - TRUE_PEAK_DELAY;
    const gains = Array.from({ length: 3 * lookahead }, (_, i) => gain(onset - 2 * lookahead + i));
    // unity until the lookahead before the step, at the target from the step on
    expect(gains.slice(0, lookahead - 1).every((value) => value === 1)).toBe(true);
    const target = CEILING / 4;
    gains.slice(2 * lookahead).forEach((value) => expect(value).toBeLessThanOrEqual(target));
    // the steepest frame of two moving averages (a triangle) is twice the mean slope
    const drop = 1 - Math.min(...gains);
    const steps = gains.slice(1).map((value, i) => gains[i] - value);
    expect(Math.min(...steps)).toBeGreaterThanOrEqual(-1e-12);
    expect(Math.max(...steps)).toBeLessThan((2.1 * drop) / lookahead);
  });

  describe('release', () => {
    // a quiet tone with a 100 Hz sine 12 dB over in it on the frames that are `loud`; the gain at times
    // after `end` (s)
    const gainsAfter = (loud: (n: number) => boolean, end: number, times: number[]) => {
      const tone = sine(440, 0.25);
      const { gain, latency } = renderCore(
        (n, channel) => tone(n, channel) + (loud(n) ? 4 * Math.sin(n / 76.4) : 0),
        end + Math.max(...times) + 0.05
      );
      // the loudest gain in the cycle of the tone at that time
      return times.map((time) => {
        const at = frame(end + time) + latency;
        return db(Math.max(...Array.from({ length: 120 }, (_, i) => gain(at + i)).filter((g) => g > 0)));
      });
    };
    // a burst from 0.1 s, the gain after it has passed
    const after = (burst: number, times: number[]) =>
      gainsAfter((n) => n >= frame(0.1) && n < frame(0.1 + burst), 0.1 + burst, times);

    it('lets a short peak go fast', () => {
      const [at200ms, at1s] = after(0.005, [0.2, 1]);
      expect(at200ms).toBeGreaterThan(-1);
      expect(at1s).toBeGreaterThan(-0.2);
    });

    it('holds the gain through the short gaps of a dense part, so it does not pump between its peaks', () => {
      // 100 ms bursts every 200 ms for 1.5 s, the last one ends at 1.5 s
      const dense = (n: number) =>
        n >= frame(0.1) && n < frame(1.6) && (n - frame(0.1)) % frame(0.2) < frame(0.1);
      const [inGap] = gainsAfter(dense, 1.5, [0.09]);
      const [alone] = after(0.1, [0.09]);
      expect(inGap).toBeLessThan(-6);
      expect(inGap).toBeLessThan(alone - 3);
      // the end of a long loud part is a gap as well, until it is longer than one
      const [long] = after(1.5, [0.2]);
      expect(long).toBeLessThan(-6);
    });

    it('lets a long loud part go fast once it is over', () => {
      const [at400ms, at500ms] = after(1.5, [0.4, 0.5]);
      expect(at400ms).toBeGreaterThan(-1);
      expect(at500ms).toBeGreaterThan(-0.2);
    });

    it('lets a long loud part go down to what a quieter part over the ceiling needs, not below', () => {
      // 12 dB over, then 2.9 dB
      const end = frame(1.6);
      const { L, gain } = renderCore((n) => (n < end ? 4 : 1.4 * CEILING) * Math.sin(n / 76.4), 2.6);
      const { min, max } = gainRange(gain, 2, 2.6);
      expect(max - min).toBeLessThan(0.001);
      expect(max).toBeCloseTo(-db(1.4), 2);
      expect(samplePeak(L)).toBeLessThanOrEqual(MAX_SAMPLE);
    });

    it('comes back to bit for bit once released', () => {
      const end = frame(1.5);
      const { L, inputs, latency } = renderCore(
        (n) => (n < end ? 4 * Math.sin(n / 7.64) : 0.5 * Math.sin(n / 7.64)),
        3
      );
      const from = frame(2.5);
      expect(L.subarray(from)).toEqual(inputs[0].subarray(from - latency, L.length - latency));
    });
  });

  it('links the sides: a loud left side turns the right one down by the same gain', () => {
    const { L, R, gain } = renderCore(
      (n, channel) => (channel ? 0.25 : 4) * Math.sin(n / (channel ? 11 : 7.64)),
      0.3
    );
    expect(samplePeak(L)).toBeLessThanOrEqual(MAX_SAMPLE);
    expect(samplePeak(R.subarray(frame(0.05)))).toBeLessThan(0.25 * (CEILING / 3));
    for (let n = frame(0.1); n < frame(0.3); n++) {
      const [left, right] = [gain(n, 0), gain(n, 1)];
      if (!Number.isNaN(left) && !Number.isNaN(right)) expect(right).toBeCloseTo(left, 6);
    }
  });

  it('treats NaN and infinities as silence and keeps working', () => {
    const tone = sine(440, 0.5);
    const broken = new Map([
      [frame(0.05), NaN],
      [frame(0.06), Infinity],
      [frame(0.07), -Infinity],
    ]);
    const { L, inputs, latency } = renderCore((n, channel) => broken.get(n) ?? tone(n, channel), 0.2);
    expect(L.every((value) => Number.isFinite(value))).toBe(true);
    broken.forEach((_, n) => expect(L[n + latency]).toBe(0));
    const from = frame(0.1);
    expect(L.subarray(from)).toEqual(inputs[0].subarray(from - latency, L.length - latency));
  });
});
