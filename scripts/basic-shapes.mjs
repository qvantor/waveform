// the table of the basic shapes (`node scripts/basic-shapes.mjs [file]`, tmp/wavetables/Basic Shapes.wav by
// default): saw, sine, triangle, the square of ramps, square, pulses of 25, 12.5, 6.25 and 3.125%, frames of
// 2048 samples, float32 mono at 44.1 kHz, its mark without a morph (each position plays one shape).
// Each frame is the Fourier series of its shape up to harmonic 1023 (all a frame gives its levels,
// wavetable-mipmap.ts), the coefficients in closed form: a shape drawn sample by sample has the harmonics
// above the nyquist of the frame folded into its top octave (up to +3.9 dB, phases off by up to 90°), these
// have the exact ones. Sample n is the shape at the phase (n + ½)/2048: an edge falls between two samples, so
// the ripple of the series by an edge peaks at 1.024 in the file (on a sample 1.18; it sounds the same, the
// levels are made from the harmonics). The shapes go from -1 to 1, the pulses keep their DC (the levels drop
// it), the rising edges (zero crossings) at phase 0, the falling ones at ½
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { writeTable } from './renders/state.mjs';

const SIZE = 2048;
const HARMONICS = SIZE / 2 - 1;

// a periodic shape of straight segments over the phase [0, 1): each from `at` (its value there, its slope);
// its complex coefficients F_k = Σ (J + S / (2πik)) · e^(-2πik·t) / (2πik) over its corners t (J the step of
// the value there, S of the slope), F_0 its mean
const segments = (parts) => {
  const next = (i) => (i + 1 < parts.length ? parts[i + 1].at : parts[0].at + 1);
  const corners = parts.map((part, i) => {
    const before = parts[(i + parts.length - 1) % parts.length];
    const end = before.value + before.slope * (next((i + parts.length - 1) % parts.length) - before.at);
    return { at: part.at, step: part.value - end, bend: part.slope - before.slope };
  });
  const mean = parts.reduce((sum, { value, slope }, i) => {
    const length = next(i) - parts[i].at;
    return sum + value * length + (slope * length * length) / 2;
  }, 0);
  const coefficient = (k) => {
    const w = 2 * Math.PI * k;
    let re = 0;
    let im = 0;
    for (const { at, step, bend } of corners) {
      // the corners are at dyadic phases: k·t mod 1 is exact
      const turn = 2 * Math.PI * ((k * at) % 1);
      const cos = Math.cos(turn);
      const sin = -Math.sin(turn);
      const bendIm = -bend / w;
      re += step * cos - bendIm * sin;
      im += step * sin + bendIm * cos;
    }
    return [im / w, -re / w];
  };
  return { mean, coefficient };
};

const pulse = (width) =>
  segments([
    { at: 0, value: -1, slope: 0 },
    { at: 0.5 - width, value: 1, slope: 0 },
    { at: 0.5, value: -1, slope: 0 },
  ]);

const SHAPES = [
  segments([
    { at: 0, value: 0, slope: 2 },
    { at: 0.5, value: -1, slope: 2 },
  ]),
  { mean: 0, coefficient: (k) => (k === 1 ? [0, -0.5] : [0, 0]) },
  segments([
    { at: 0, value: 0, slope: 4 },
    { at: 0.25, value: 1, slope: -4 },
    { at: 0.75, value: -1, slope: 4 },
  ]),
  // each half of a square falls to 0: odd harmonics, a saw's above the fundamental
  segments([
    { at: 0, value: 1, slope: -2 },
    { at: 0.5, value: -1, slope: 2 },
  ]),
  segments([
    { at: 0, value: 1, slope: 0 },
    { at: 0.5, value: -1, slope: 0 },
  ]),
  pulse(1 / 4),
  pulse(1 / 8),
  pulse(1 / 16),
  pulse(1 / 32),
];

// the phases (n + ½) / SIZE of the harmonics: m / (2·SIZE) turns, m = k·(2n + 1) mod 2·SIZE
const COS = Float64Array.from({ length: 2 * SIZE }, (_, m) => Math.cos((Math.PI * m) / SIZE));
const SIN = Float64Array.from({ length: 2 * SIZE }, (_, m) => Math.sin((Math.PI * m) / SIZE));

const frame = ({ mean, coefficient }) => {
  const coefficients = Array.from({ length: HARMONICS }, (_, i) => coefficient(i + 1));
  return Array.from({ length: SIZE }, (_, n) => {
    let value = mean;
    coefficients.forEach(([re, im], i) => {
      const m = ((i + 1) * (2 * n + 1)) % (2 * SIZE);
      value += 2 * (re * COS[m] - im * SIN[m]);
    });
    return value;
  });
};

const file =
  process.argv[2] ?? join(new URL('..', import.meta.url).pathname, 'tmp/wavetables/Basic Shapes.wav');
mkdirSync(dirname(file), { recursive: true });
writeTable(file, SHAPES.map(frame), '01000000');
console.log(`${SHAPES.length} frames: ${file}`);
