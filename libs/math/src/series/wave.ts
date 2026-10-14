import FFT from 'fft.js';

// Fourier series of one cycle for createPeriodicWave: real[k] and imag[k] are the cosine and sine amplitudes
// of harmonic k, x(t) = Σ real[k]·cos(2πkt) + imag[k]·sin(2πkt), so the wave plays as drawn whatever its phase;
// DC and the Nyquist bin are dropped
export const realWithImag = (wave: number[]): [number[], number[]] => {
  const size = wave.length;
  const fft = new FFT(size);
  const spectrum: number[] = fft.createComplexArray();
  // fills bins 0..size/2, interleaved re, im
  fft.realTransform(spectrum, wave);

  const real = new Array<number>(size / 2).fill(0);
  const imag = new Array<number>(size / 2).fill(0);
  for (let k = 1; k < size / 2; k++) {
    real[k] = (2 / size) * spectrum[2 * k];
    imag[k] = (-2 / size) * spectrum[2 * k + 1];
  }
  return [real, imag];
};
