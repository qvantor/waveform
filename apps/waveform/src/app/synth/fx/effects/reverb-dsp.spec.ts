import FFT from 'fft.js';
import { FX_PARAMS } from '@waveform/preset-schema';
import { wasmCore } from '../../../../test-utils/wasm';
import { DECAY_CHART_FREQS, decayCurve } from '../components/controls/reverb-decay-curve';
import { createTestBiquad } from '../../../../test-utils/biquad';
import { MAX_PREDELAY, MAX_SIZE, ReverbDspParams, ReverbOptions } from './reverb-params';
import { HF_RATIO } from './reverb-decay';
import { createReverbWasm, ReverbExports } from './reverb-wasm';

// the Rust core (dsp/reverb), one instance of it for the spec (a scope)
const core = wasmCore<ReverbExports>('reverb');
const create = (sampleRate: number, options: ReverbOptions) => createReverbWasm(core, sampleRate, options);

const SAMPLE_RATE = 48000;
const BLOCK = 128;

// a clean, undamped tail without reflections or predelay
const BASE: ReverbDspParams = {
  lowcut: 20,
  pre: 0,
  size: 0.5,
  decay: 2,
  damp: 20000,
  bass: 1,
  depth: 0.2,
  sep: 1,
  er: 0,
  drive: 0,
  bandwidth: SAMPLE_RATE / 2,
  body: 0,
};

type Input = (frame: number) => number;
interface Change {
  at: number;
  params?: Partial<ReverbDspParams>;
  // the params are knobs the envelopes move
  routed?: boolean;
  active?: boolean;
  // the tail is forgotten (a preset switch)
  clear?: boolean;
}

const impulse: Input = (frame) => (frame === 0 ? 1 : 0);
// deterministic white noise for `seconds`, then silence
const noise = (seconds: number): Input => {
  let seed = 1;
  return (frame) => {
    seed = (seed * 16807) % 2147483647;
    return frame < seconds * SAMPLE_RATE ? (seed / 2147483647) * 2 - 1 : 0;
  };
};
const sine =
  (freq: number, amplitude = 1): Input =>
  (frame) =>
    amplitude * Math.sin((2 * Math.PI * freq * frame) / SAMPLE_RATE);

// renders in render quanta like the worklet, the changes apply at the start of the block holding `at`

const render = (
  params: Partial<ReverbDspParams>,
  seconds: number,
  input: Input = impulse,
  changes: Change[] = [],
  active = true
) => {
  const dsp = create(SAMPLE_RATE, { params: { ...BASE, ...params }, active });
  const frames = Math.ceil((seconds * SAMPLE_RATE) / BLOCK) * BLOCK;
  const [L, R] = [new Float32Array(frames), new Float32Array(frames)];
  const block = new Float32Array(BLOCK);
  // per block: skipped after it
  const idle: boolean[] = [];
  for (let start = 0; start < frames; start += BLOCK) {
    changes
      .filter(({ at }) => Math.floor((at * SAMPLE_RATE) / BLOCK) * BLOCK === start)
      .forEach((change) => {
        if (change.params) dsp.set(change.params, change.routed);
        if (change.active !== undefined) dsp.setActive(change.active);
        if (change.clear) dsp.clear();
      });
    for (let i = 0; i < BLOCK; i++) block[i] = input(start + i);
    dsp.process(block, block, L.subarray(start, start + BLOCK), R.subarray(start, start + BLOCK));
    idle.push(dsp.idle);
  }
  return { L, R, mono: Float32Array.from(L, (value, i) => value + R[i]), idle };
};

const frame = (seconds: number) => Math.round(seconds * SAMPLE_RATE);

// an octave around `freq` (2 bandpasses), or a lowpass below it
const filtered = (data: Float32Array, type: 'bandpass' | 'lowpass', freq: number) => {
  const filters = [0, 1].map(() =>
    createTestBiquad(type, { frequency: freq, Q: type === 'bandpass' ? 1.41 : -3.01, gain: 0 }, SAMPLE_RATE)
  );
  return Float32Array.from(data, (value) => filters[1].process(filters[0].process(value)));
};

const levelDb = (data: Float32Array, from: number, to: number) => {
  let sum = 0;
  for (let i = frame(from); i < frame(to); i++) sum += data[i] * data[i];
  return 10 * Math.log10(sum / (frame(to) - frame(from)) + 1e-30);
};

// T30: the slope of the Schroeder backward integral from -5 to -35 dB, extended to 60 dB
const rt60 = (data: Float32Array) => {
  const energy = new Float64Array(data.length);
  for (let i = data.length - 1, sum = 0; i >= 0; i--) energy[i] = sum += data[i] * data[i];
  const db = (i: number) => 10 * Math.log10(energy[i] / energy[0]);
  let start = 0;
  while (db(start) > -5) start++;
  let end = start;
  while (end < data.length - 1 && db(end) > -35) end++;
  let [n, sx, sy, sxx, sxy] = [0, 0, 0, 0, 0];
  for (let i = start; i <= end; i += 8) {
    const [x, y] = [i / SAMPLE_RATE, db(i)];
    [n, sx, sy, sxx, sxy] = [n + 1, sx + x, sy + y, sxx + x * x, sxy + x * y];
  }
  return -60 / ((n * sxy - sx * sy) / (n * sxx - sx * sx));
};

// how peaky the spectrum of a tail segment is: 90th percentile / median of the power (200..1200 Hz),
// about 5 dB for white noise, high for separate ringing modes
const ringDb = (data: Float32Array, from: number, to: number) => {
  const size = 65536;
  const fft = new FFT(size);
  const input = new Array(size).fill(0);
  const length = frame(to) - frame(from);
  for (let i = 0; i < length; i++) {
    input[i] = data[frame(from) + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / length));
  }
  const spectrum = fft.createComplexArray();
  fft.realTransform(spectrum, input);
  const power: number[] = [];
  for (let k = Math.ceil((200 * size) / SAMPLE_RATE); k <= (1200 * size) / SAMPLE_RATE; k++) {
    power.push(spectrum[2 * k] ** 2 + spectrum[2 * k + 1] ** 2);
  }
  power.sort((a, b) => a - b);
  return 10 * Math.log10(power[Math.floor(power.length * 0.9)] / power[Math.floor(power.length / 2)]);
};

// the amplitude of `freq` (a single DFT bin), over whole periods of it
const amplitude = (data: Float32Array, freq: number, from: number, to: number) => {
  let [re, im] = [0, 0];
  for (let i = frame(from); i < frame(to); i++) {
    const phase = (2 * Math.PI * freq * i) / SAMPLE_RATE;
    [re, im] = [re + data[i] * Math.cos(phase), im + data[i] * Math.sin(phase)];
  }
  return (2 * Math.hypot(re, im)) / (frame(to) - frame(from));
};

// the largest step between neighbouring samples
const maxStep = (data: Float32Array, from: number, to: number) => {
  let max = 0;
  for (let i = frame(from) + 1; i < frame(to); i++) max = Math.max(max, Math.abs(data[i] - data[i - 1]));
  return max;
};

describe('the reverb', () => {
  it('allocates the buffers for the whole param ranges', () => {
    expect(MAX_PREDELAY).toBe(FX_PARAMS.reverb.pre.max);
    expect(MAX_SIZE).toBe(FX_PARAMS.reverb.size.max);
  });

  describe('decay', () => {
    // the loops are exact to the sample: no render quantum is added to a loop like in a node cycle
    it.each([0, 0.5, 1].flatMap((size) => [0.5, 2, 8].map((decay) => [size, decay])))(
      'size %p: the mids ring the decay of %p s, as the chart shows',
      (size, decay) => {
        const { mono } = render({ size, decay }, decay * 0.75 + 0.3);
        const measured = rt60(filtered(mono, 'bandpass', 1000));
        expect(measured / decay).toBeGreaterThan(0.88);
        expect(measured / decay).toBeLessThan(1.12);
        const chart = decayCurve({ size, decay, damp: BASE.damp, bass: BASE.bass }, SAMPLE_RATE)[
          DECAY_CHART_FREQS.findIndex((freq) => freq > 1000)
        ];
        expect(measured / chart).toBeGreaterThan(0.88);
        expect(measured / chart).toBeLessThan(1.12);
      }
    );

    it('bass sets the decay of the lows', () => {
      const { mono } = render({ decay: 1, bass: 3 }, 4);
      expect(rt60(filtered(mono, 'bandpass', 80)) / 3).toBeGreaterThan(0.8);
      expect(rt60(filtered(mono, 'bandpass', 2000))).toBeCloseTo(1, 0);
    });

    it('the highs above hi damp ring decay × HF_RATIO', () => {
      const { mono } = render({ decay: 2, damp: 1000 }, 2.3);
      const highs = rt60(filtered(mono, 'bandpass', 8000));
      expect(highs / (2 * HF_RATIO)).toBeGreaterThan(0.8);
      expect(highs / (2 * HF_RATIO)).toBeLessThan(1.2);
    });

    // the tail is tapped after the decay gain: the first echo of a line is attenuated too
    it('a short decay is short from the first echo, also in a large room', () => {
      const short = render({ size: 1, decay: 0.1 }, 0.5).mono;
      const longer = render({ size: 1, decay: 0.3 }, 0.5).mono;
      expect(rt60(short)).toBeLessThan(0.13);
      expect(levelDb(longer, 0.04, 0.14) - levelDb(short, 0.04, 0.14)).toBeGreaterThan(8);
      expect(levelDb(longer, 0.14, 0.24) - levelDb(short, 0.14, 0.24)).toBeGreaterThan(30);
    });

    // the first echoes of a large room already passed the highshelf once
    it('hi damp darkens the tail from its start', () => {
      const brightness = (damp: number) => {
        const { mono } = render({ size: 1, damp }, 0.1);
        const level = (freq: number) => levelDb(filtered(mono, 'bandpass', freq), 0, 0.1);
        return level(8000) - level(500);
      };
      expect(brightness(20000) - brightness(2000)).toBeGreaterThan(5);
    });

    // without modulation the modes of a small room with a long decay rang as separate tones (32 dB at
    // size 0 and 8 s); the 16 lines and their growth with long decays keep them overlapping
    it.each([
      [0, 8, 9],
      [0, 4, 14],
      [0.5, 8, 8],
      [1, 8, 7],
    ])('size %p, decay %p s, no modulation: the tail rings like noise (< %p dB)', (size, decay, limit) => {
      const { L } = render({ size, decay, depth: 0 }, 2.05);
      expect(ringDb(L, 1, 2)).toBeLessThan(limit);
    });

    it('the modulation smears the modes of a small room further', () => {
      const ring = (depth: number) => ringDb(render({ size: 0, decay: 3, depth }, 2.05).L, 1, 2);
      expect(ring(0.2)).toBeLessThan(9);
      expect(ring(0.2)).toBeLessThan(ring(0) - 5);
    });

    // the allpass in every line multiplies the echoes on every pass
    it('a large room gets a dense tail within 120 ms', () => {
      const { L } = render({ size: 1, depth: 0 }, 0.15);
      const start = frame(0.12);
      const window = L.slice(start, start + frame(0.02));
      const sd = Math.sqrt(window.reduce((sum, value) => sum + value * value, 0) / window.length);
      // normalized echo density (Abel & Huang): about 1 for a gaussian, i.e. a fully dense tail
      const density = window.filter((value) => Math.abs(value) > sd).length / window.length / 0.3173;
      expect(density).toBeGreaterThan(0.85);
    });
  });

  describe('param changes', () => {
    // the gain and the shelves of a line come from the same values: no pass gains, also while gliding
    it.each([
      ['decay 0.2 → 20 s with bass 4', { size: 1, decay: 0.2, bass: 4 }, { decay: 20 }],
      ['decay 0.1 → 20 s with bass 4', { size: 1, decay: 0.1, bass: 4 }, { decay: 20 }],
      ['bass 0.25 → 4', { size: 1, decay: 0.5, bass: 0.25 }, { bass: 4 }],
      ['size 1 → 0.15', { size: 1, decay: 9, bass: 1.5 }, { size: 0.15, decay: 0.6, bass: 1 }],
    ] as [string, Partial<ReverbDspParams>, Partial<ReverbDspParams>][])(
      '%s: the ringing tail never gets louder',
      (_, from, to) => {
        const { mono } = render(from, 0.5, noise(0.05), [{ at: 0.15, params: to }]);
        const lows = filtered(mono, 'lowpass', 120);
        [mono, lows].forEach((data) => {
          const before = levelDb(data, 0.12, 0.15);
          for (let t = 0.15; t < 0.45; t += 0.01) {
            expect(levelDb(data, t, t + 0.03)).toBeLessThan(before + 0.5);
          }
        });
      }
    );

    it('a shorter decay ends the tail quickly', () => {
      const { mono } = render({ decay: 20 }, 0.6, noise(0.05), [{ at: 0.15, params: { decay: 0.1 } }]);
      expect(levelDb(mono, 0.45, 0.5) - levelDb(mono, 0.1, 0.15)).toBeLessThan(-60);
    });

    it.each([
      ['era 80s → 70s', { drive: 0, bandwidth: 10000, body: 1 }, { drive: 0.15, bandwidth: 6500, body: 2 }],
      ['predelay', { pre: 0.02 }, { pre: 0.25 }],
      ['size', { size: 0.2 }, { size: 0.9 }],
      ['low cut and hi damp', { lowcut: 20, damp: 6000 }, { lowcut: 600, damp: 1500 }],
    ] as [string, Partial<ReverbDspParams>, Partial<ReverbDspParams>][])(
      '%s glides without clicks under a loud sine',
      (_, from, to) => {
        const { L } = render({ er: 1, ...from }, 1.2, sine(220, 2), [{ at: 0.8, params: to }]);
        expect(maxStep(L, 0.8, 1.2)).toBeLessThan(maxStep(L, 0.4, 0.8) * 1.5);
      }
    );

    // an impulse at 0.05 s after the change at 0: the first sample out (the first early reflection) comes
    // after the predelay and the first tap of the room at the time it passes
    it.each([
      ['predelay', { pre: 0 }, { pre: 0.1 }, 0.02],
      ['size', { size: 0 }, { size: 1 }, 0.002],
    ] as [string, Partial<ReverbDspParams>, Partial<ReverbDspParams>, number][])(
      '%s moved by an envelope follows it in 10 ms, a knob glides like tape',
      (_, from, to, earlier) => {
        const pulse: Input = (frame) => impulse(frame - Math.round(0.05 * SAMPLE_RATE));
        const onset = (changes: Change[], params = from) =>
          render({ er: 1, ...params }, 0.3, pulse, changes).mono.findIndex((value) => value !== 0);
        const target = onset([], { ...from, ...to });
        expect(Math.abs(onset([{ at: 0, params: to, routed: true }]) - target)).toBeLessThan(frame(0.0005));
        expect(onset([{ at: 0, params: to }])).toBeLessThan(target - frame(earlier));
      }
    );
  });

  describe('input stage and routing', () => {
    it('predelay: nothing comes out before it', () => {
      const { mono } = render({ pre: 0.1, er: 1 }, 0.2);
      expect(mono.slice(0, frame(0.1)).every((value) => value === 0)).toBe(true);
      expect(levelDb(mono, 0.1, 0.2)).toBeGreaterThan(-100);
    });

    it('the early reflections come before the tail, ER sets their level', () => {
      const { mono: dry } = render({ size: 1, er: 0 }, 0.04);
      const { mono: early } = render({ size: 1, er: 1 }, 0.04);
      // the shortest line of a large room is 40 ms long
      expect(levelDb(dry, 0, 0.03)).toBeLessThan(-150);
      expect(levelDb(early, 0, 0.03)).toBeGreaterThan(-40);
    });

    it('sep 0 is mono, sep 1 keeps the sides apart', () => {
      const mono = render({ sep: 0, er: 1 }, 0.5);
      expect(mono.L).toEqual(mono.R);
      const wide = render({ sep: 1, er: 1 }, 0.5);
      let [lr, ll, rr] = [0, 0, 0];
      wide.L.forEach((l, i) => {
        const r = wide.R[i];
        [lr, ll, rr] = [lr + l * r, ll + l * l, rr + r * r];
      });
      expect(Math.abs(lr / Math.sqrt(ll * rr))).toBeLessThan(0.3);
    });

    it('low cut removes the lows, the era bandwidth the highs', () => {
      const level = (params: Partial<ReverbDspParams>, freq: number) =>
        levelDb(render({ decay: 0.5, ...params }, 0.6, sine(freq)).mono, 0.3, 0.6);
      expect(level({ lowcut: 600 }, 60) - level({ lowcut: 20 }, 60)).toBeLessThan(-20);
      expect(level({ bandwidth: 6500 }, 15000) - level({}, 15000)).toBeLessThan(-12);
    });

    it('the 70s tube adds a subtle 2nd harmonic to loud input, quiet input stays clean', () => {
      const secondDb = (level: number, drive: number) => {
        const { mono } = render({ drive, decay: 0.3, depth: 0 }, 0.6, sine(200, level));
        return 20 * Math.log10(amplitude(mono, 400, 0.3, 0.6) / amplitude(mono, 200, 0.3, 0.6));
      };
      expect(secondDb(2, 0.15)).toBeGreaterThan(-40);
      expect(secondDb(2, 0.15)).toBeLessThan(-20);
      expect(secondDb(0.1, 0.15)).toBeLessThan(secondDb(2, 0.15) - 15);
      expect(secondDb(2, 0)).toBeLessThan(-80);
    });
  });

  describe('active', () => {
    it('inactive: fades out and stays silent, the old tail never comes back', () => {
      const { mono } = render({ decay: 20 }, 1.5, noise(0.1), [
        { at: 0.3, active: false },
        { at: 1, active: true },
      ]);
      expect(levelDb(mono, 0.2, 0.3)).toBeGreaterThan(-60);
      expect(mono.slice(frame(0.6)).every((value) => value === 0)).toBe(true);
    });

    it('created inactive: silent until activated', () => {
      const { mono } = render({}, 0.6, noise(0.6), [{ at: 0.3, active: true }], false);
      expect(mono.slice(0, frame(0.29)).every((value) => value === 0)).toBe(true);
      expect(levelDb(mono, 0.4, 0.6)).toBeGreaterThan(-60);
    });

    it('a drained tail is skipped, new input wakes it up with the current params', () => {
      const wake = 1.6;
      const input: Input = (frame) => impulse(frame) || impulse(frame - Math.round(wake * SAMPLE_RATE) / 1);
      const { mono } = render({ decay: 0.1 }, 2, input, [{ at: 1.2, params: { decay: 0.2 } }]);
      expect(mono.slice(frame(1.4), frame(wake)).every((value) => value === 0)).toBe(true);
      const woken = rt60(mono.slice(frame(wake)));
      expect(woken).toBeGreaterThan(0.15);
      expect(woken).toBeLessThan(0.25);
    });

    it('created inactive: skips every block', () => {
      const { idle } = render({}, 1, () => 0, [], false);
      expect(idle.every(Boolean)).toBe(true);
    });

    it('created active: renders silence until its longest path has drained, then skips the blocks', () => {
      // the predelay at its most, the last early reflection, the diffusers and the longest line of the
      // largest room: 0.561 s, 211 blocks at 48 kHz (a reverb added to the chain renders them)
      const { idle } = render({}, 1, () => 0);
      expect(idle.indexOf(true)).toBe(210);
      expect(idle.slice(210).every(Boolean)).toBe(true);
    });

    it('clear forgets the tail at once, the next sound rings at the params as they are then', () => {
      const wake = 1;
      const burst = noise(0.1);
      const input: Input = (at) => burst(at) || impulse(at - frame(wake));
      const { mono, idle } = render({ decay: 20 }, 2, input, [
        { at: 0.3, clear: true },
        { at: 0.5, params: { decay: 0.2 } },
      ]);
      expect(levelDb(mono, 0.2, 0.29)).toBeGreaterThan(-60);
      expect(mono.slice(frame(0.3), frame(wake)).every((value) => value === 0)).toBe(true);
      expect(idle[Math.floor(frame(0.3) / BLOCK)]).toBe(true);
      // no glide from the decay before
      const woken = rt60(mono.slice(frame(wake)));
      expect(woken).toBeGreaterThan(0.15);
      expect(woken).toBeLessThan(0.25);
    });

    it('ignores unknown and missing params', () => {
      const dsp = create(SAMPLE_RATE, { params: BASE, active: true });
      expect(() => dsp.set({ time: 1, decay: undefined } as never)).not.toThrow();
    });
  });
});
