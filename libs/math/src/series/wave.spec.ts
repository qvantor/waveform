import { realWithImag } from './wave';

const N = 64;
const HALF = N / 2;

// one cycle of N samples, the phase goes 0..2π
const periodic = (fn: (phase: number) => number) =>
  Array.from({ length: N }, (_, i) => fn((2 * Math.PI * i) / N));

// the waveform createPeriodicWave plays: x(t) = Σ real[k]·cos(kt) + imag[k]·sin(kt)
const synthesize = (real: number[], imag: number[]) =>
  periodic((phase) =>
    real.reduce((sum, a, k) => sum + a * Math.cos(k * phase) + imag[k] * Math.sin(k * phase), 0)
  );

// only harmonic k has the amplitude
const harmonic = (k: number, amplitude: number) =>
  Array.from({ length: HALF }, (_, i) => (i === k ? amplitude : 0));
const silence = new Array(HALF).fill(0);

// deterministic amplitudes in -1..1 for every harmonic, no DC
const amplitudes = (seed: number) =>
  Array.from({ length: HALF }, (_, k) => (k === 0 ? 0 : Math.sin(k * seed)));

const expectClose = (actual: number[], expected: number[]) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 10));
};

describe('wave.realWithImag', () => {
  it('returns cosine and sine amplitudes of the same size, one per harmonic below Nyquist', () => {
    const [real, imag] = realWithImag(periodic((phase) => Math.sin(phase) + Math.cos(7 * phase)));
    expect(real).toHaveLength(HALF);
    expect(imag).toHaveLength(HALF);
    [...real, ...imag].forEach((value) => expect(Number.isFinite(value)).toBe(true));
  });

  it('puts a sine into the sine amplitudes of its harmonic', () => {
    const [real, imag] = realWithImag(periodic(Math.sin));
    expectClose(real, silence);
    expectClose(imag, harmonic(1, 1));

    const [real3, imag3] = realWithImag(periodic((phase) => Math.sin(3 * phase)));
    expectClose(real3, silence);
    expectClose(imag3, harmonic(3, 1));
  });

  // the cosine part used to be replaced by the raw samples, a cosine wave played as junk
  it('puts a cosine into the cosine amplitudes of its harmonic', () => {
    const [real, imag] = realWithImag(periodic(Math.cos));
    expectClose(real, harmonic(1, 1));
    expectClose(imag, silence);
  });

  it('splits a mix into its harmonics and drops DC', () => {
    const [real, imag] = realWithImag(
      periodic((phase) => 0.5 * Math.sin(3 * phase) + 0.25 * Math.cos(5 * phase) + 0.3)
    );
    expectClose(real, harmonic(5, 0.25));
    expectClose(imag, harmonic(3, 0.5));

    const [constantReal, constantImag] = realWithImag(new Array(N).fill(1));
    expectClose(constantReal, silence);
    expectClose(constantImag, silence);
  });

  it('returns the amplitudes a wave was synthesized from', () => {
    const real = amplitudes(1.7);
    const imag = amplitudes(2.3);

    const [outReal, outImag] = realWithImag(synthesize(real, imag));

    expectClose(outReal, real);
    expectClose(outImag, imag);
  });

  it('plays a wave back as it is', () => {
    const wave = periodic(
      (phase) => Math.sin(phase) - 0.4 * Math.cos(2 * phase) + 0.2 * Math.sin(9 * phase + 1)
    );
    expectClose(synthesize(...realWithImag(wave)), wave);
  });

  // a shifted copy of a wave sounds the same: same amplitude of every harmonic, only the phases differ
  it('gives a shifted wave the same harmonic amplitudes', () => {
    const saw = periodic((phase) => phase / Math.PI - 1);
    const shifted = [...saw.slice(N / 4), ...saw.slice(0, N / 4)];
    const magnitudes = ([real, imag]: [number[], number[]]) => real.map((a, k) => Math.hypot(a, imag[k]));

    const [shiftedReal] = realWithImag(shifted);
    // a quarter cycle turns the sine of the first harmonic into a cosine
    expect(Math.abs(shiftedReal[1])).toBeGreaterThan(0.5);
    expectClose(magnitudes(realWithImag(shifted)), magnitudes(realWithImag(saw)));
  });
});
