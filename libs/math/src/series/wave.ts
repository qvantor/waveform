import FFT from 'fft.js';

// Fourier series of one cycle for createPeriodicWave: real[k] and imag[k] are the cosine and sine amplitudes
// of harmonic k, x(t) = Σ real[k]·cos(2πkt) + imag[k]·sin(2πkt), so the wave plays as drawn whatever its phase;
// DC and the Nyquist bin are dropped
export const realWithImag = (wave: ArrayLike<number>): [number[], number[]] => {
  const size = wave.length;
  if (size < 2 || size & (size - 1)) return dftRealWithImag(wave);
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

// realWithImag of a wave whose length is not a power of two (the FFT needs one), harmonics below its nyquist
const dftRealWithImag = (wave: ArrayLike<number>): [number[], number[]] => {
  const size = wave.length;
  const half = Math.ceil(size / 2);
  const real = new Array<number>(half).fill(0);
  const imag = new Array<number>(half).fill(0);
  for (let k = 1; k < size / 2; k++) {
    for (let n = 0; n < size; n++) {
      const phase = (2 * Math.PI * k * n) / size;
      real[k] += (2 / size) * wave[n] * Math.cos(phase);
      imag[k] += (2 / size) * wave[n] * Math.sin(phase);
    }
  }
  return [real, imag];
};

const ffts = new Map<number, { fft: FFT; spectrum: Float64Array; samples: Float64Array }>();
const fftOf = (size: number) => {
  const cached = ffts.get(size);
  if (cached) return cached;
  const created = {
    fft: new FFT(size),
    spectrum: new Float64Array(2 * size),
    samples: new Float64Array(2 * size),
  };
  ffts.set(size, created);
  return created;
};

// one cycle of `size` samples (a power of two, at least 2) from its Fourier series (realWithImag), harmonics
// 1..count: x[n] = Σ real[k]·cos(2πkn/size) + imag[k]·sin(2πkn/size), the inverse of realWithImag. Harmonics
// at or above size/2 are dropped (they would fold back)
export const fromRealWithImag = <T extends Float32Array | Float64Array = Float64Array>(
  real: ArrayLike<number>,
  imag: ArrayLike<number>,
  count: number,
  size: number,
  out: T = new Float64Array(size) as T
): T => {
  const { fft, spectrum, samples } = fftOf(size);
  spectrum.fill(0);
  const harmonics = Math.min(count, size / 2 - 1, real.length - 1, imag.length - 1);
  // bin k is size/2 · (real - i·imag), bin size - k its conjugate; the inverse divides by size
  for (let k = 1; k <= harmonics; k++) {
    const re = (size / 2) * real[k];
    const im = (-size / 2) * imag[k];
    spectrum[2 * k] = re;
    spectrum[2 * k + 1] = im;
    spectrum[2 * (size - k)] = re;
    spectrum[2 * (size - k) + 1] = -im;
  }
  fft.inverseTransform(samples, spectrum);
  for (let n = 0; n < size; n++) out[n] = samples[2 * n];
  return out;
};
