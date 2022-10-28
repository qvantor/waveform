import FFT from 'fft.js';

export const realWithImag = (real: number[]): [number[], number[]] => {
  const f = new FFT(real.length);
  const imag = new Array(real.length);
  f.realTransform(imag, real);

  const imagOutput: number[] = [];
  for (let i = 0; i < imag.length; i++) {
    if (i % 2 === 0) continue;
    imagOutput.push(imag[i]);
  }
  return [real, imagOutput];
};
