import { realWithImag } from './wave';

const N = 64;
// only bins 0..N/2 are computed (completeSpectrum is not called), the rest of the output is not checked
const lowerHalf = (imag: number[]) => imag.slice(0, N / 2 + 1);

const periodic = (fn: (phase: number) => number) =>
  Array.from({ length: N }, (_, i) => fn((2 * Math.PI * i) / N));

describe('wave.realWithImag', () => {
  it('returns the input as real part and an imaginary part of the same size', () => {
    const real = periodic(Math.sin);
    const [outReal, imag] = realWithImag(real);
    expect(outReal).toBe(real);
    expect(imag).toHaveLength(N);
    imag.forEach((value) => expect(Number.isFinite(value)).toBe(true));
  });

  it('puts a sine into the first harmonic', () => {
    const [, imag] = realWithImag(periodic(Math.sin));
    expect(imag[1]).toBeCloseTo(-N / 2);
    lowerHalf(imag).forEach((value, i) => i !== 1 && expect(value).toBeCloseTo(0));
  });

  it('puts a sine of the third harmonic into the third bin', () => {
    const [, imag] = realWithImag(periodic((phase) => Math.sin(3 * phase)));
    expect(imag[3]).toBeCloseTo(-N / 2);
    lowerHalf(imag).forEach((value, i) => i !== 3 && expect(value).toBeCloseTo(0));
  });

  it('has no imaginary part for even (cosine) and constant waves', () => {
    lowerHalf(realWithImag(periodic(Math.cos))[1]).forEach((value) => expect(value).toBeCloseTo(0));
    lowerHalf(realWithImag(new Array(N).fill(1))[1]).forEach((value) => expect(value).toBeCloseTo(0));
  });
});
