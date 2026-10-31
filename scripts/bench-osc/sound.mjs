// the sound of the oscillator benchmark, shared by its page (bench-page.ts) and the renders of the Audio Unit of
// the stand (scripts/renders, --only=aliasing): the tables and the pitches, the frame of a table they are compared
// at and the analysis of a render
import FFT from 'fft.js';

export const TABLES = [
  'ESW Core Tables/Basics/ESW Basics - Saw Collection.wav',
  'ESW Core Tables/Digital/ESW Digital - Air Lazer.wav',
  'ESW Core Tables/Vocal/ESW Vocal - Ahhh 01.wav',
];
export const PITCHES = [55, 220, 1046, 3520, 7040];
// samples of a spectrum (the last ones of a render)
export const SIZE = 65536;
const WAVE_SIZE = 2048;

// a band-limited saw of 2048 samples, every harmonic at 1/k
export const sawFrame = () => {
  const frame = new Array(WAVE_SIZE).fill(0);
  for (let k = 1; k < WAVE_SIZE / 2; k++)
    for (let n = 0; n < WAVE_SIZE; n++) frame[n] += Math.sin((2 * Math.PI * k * n) / WAVE_SIZE) / k;
  return frame;
};

// the frame of a table the sound is compared at: the saw, the middle frame of a real table
export const frameOf = (frames) => Math.floor((frames.length - 1) / 2);

const besselI0 = (x) => {
  let sum = 1;
  let term = 1;
  for (let k = 1; term > sum * 1e-17; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
  }
  return sum;
};
// a Kaiser window of β = 38: its sidelobes are far below any aliasing (−300 dB), its main lobe ±12 bins
const BETA = 38;
const BAND = 14;
const windows = new Map();
export const kaiser = (n) => {
  const cached = windows.get(n);
  if (cached) return cached;
  const window = Float64Array.from(
    { length: n },
    (_, i) => besselI0(BETA * Math.sqrt(1 - ((2 * i) / (n - 1) - 1) ** 2)) / besselI0(BETA)
  );
  windows.set(n, window);
  return window;
};

const powerSpectrum = (signal) => {
  const window = kaiser(SIZE);
  const fft = new FFT(SIZE);
  const input = new Float64Array(SIZE);
  const from = signal.length - SIZE;
  for (let i = 0; i < SIZE; i++) input[i] = signal[from + i] * window[i];
  const out = fft.createComplexArray();
  fft.realTransform(out, input);
  return Float64Array.from({ length: SIZE / 2 }, (_, k) => out[2 * k] ** 2 + out[2 * k + 1] ** 2);
};

// the amplitude of each harmonic of a frame (a power of two long; DC and the nyquist bin 0, as realWithImag of
// @waveform/math gives them)
const harmonicsOf = (frame) => {
  const size = frame.length;
  const fft = new FFT(size);
  const out = fft.createComplexArray();
  fft.realTransform(out, frame);
  return Array.from({ length: size / 2 }, (_, k) =>
    k ? (2 / size) * Math.hypot(out[2 * k], out[2 * k + 1]) : 0
  );
};

// aliasing: the power outside the bands of the harmonics against their power; spur: the loudest bin
// outside them against the fundamental; highest: the number of the highest harmonic played at half its
// amplitude in the frame at least (against the loudest one; harmonics 80 dB below it don't count); rms of
// the analysed samples
export const analyze = (signal, frequency, rate, frame) => {
  const spectrum = powerSpectrum(signal);
  const expected = harmonicsOf(frame);
  const loudest = expected.indexOf(Math.max(...expected));
  const bands = [];
  const binsPerHz = SIZE / rate;
  const inBand = new Uint8Array(spectrum.length);
  let harmonics = 0;
  let fundamentalPeak = 0;
  let highest = 0;
  for (let h = 1; h * frequency < rate / 2; h++) {
    const center = Math.round(h * frequency * binsPerHz);
    let power = 0;
    for (let k = Math.max(0, center - BAND); k <= Math.min(spectrum.length - 1, center + BAND); k++) {
      inBand[k] = 1;
      power += spectrum[k];
      if (h === 1) fundamentalPeak = Math.max(fundamentalPeak, spectrum[k]);
    }
    bands[h] = power;
    harmonics += power;
  }
  for (let h = 1; h < bands.length && h < expected.length; h++) {
    if (expected[h] < expected[loudest] * 1e-4) continue;
    const played = Math.sqrt(bands[h] / bands[loudest]) / (expected[h] / expected[loudest]);
    if (played >= 0.5) highest = h;
  }
  let other = 0;
  let worst = 0;
  for (let k = BAND + 1; k < spectrum.length; k++) {
    if (inBand[k]) continue;
    other += spectrum[k];
    worst = Math.max(worst, spectrum[k]);
  }
  let squares = 0;
  for (let i = signal.length - SIZE; i < signal.length; i++) squares += signal[i] ** 2;
  return {
    aliasing: 10 * Math.log10(other / harmonics),
    spur: 10 * Math.log10(worst / fundamentalPeak),
    highest,
    rms: Math.sqrt(squares / SIZE),
  };
};
