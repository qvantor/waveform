import { wave } from '@waveform/math';
import { createLevels, frameStart, levelHarmonics, levelLength, WavetableLevels } from './wavetable-levels';
import { buildLevels, MAX_FRAMES, writeFrame } from './wavetable-mipmap';

// one cycle of `size` samples from its harmonics: x(t) = Σ a·sin(2πkt + phase)
const cycle = (size: number, harmonics: [number, number, number?][]) =>
  Array.from({ length: size }, (_, n) =>
    harmonics.reduce((sum, [k, a, phase = 0]) => sum + a * Math.sin((2 * Math.PI * k * n) / size + phase), 0)
  );

// a band-limited saw of 2048 samples, every harmonic at 1/k
const saw = (size = 2048) =>
  cycle(
    size,
    Array.from({ length: size / 2 - 1 }, (_, i): [number, number] => [i + 1, 1 / (i + 1)])
  );

// the cycle of a frame on a level, without the samples around it
const frameOf = (levels: WavetableLevels, level: number, index: number) => {
  const start = frameStart(levels, level, index) + 1;
  return levels.data.subarray(start, start + levels.lengths[level]);
};
// with them: the last sample, the cycle, the first two samples
const guardedFrameOf = (levels: WavetableLevels, level: number, index: number) => {
  const start = frameStart(levels, level, index);
  return levels.data.subarray(start, start + levels.lengths[level] + 3);
};

// cosine and sine amplitudes of a level of a frame
const spectrumOf = (levels: WavetableLevels, level: number, index: number) =>
  wave.realWithImag(frameOf(levels, level, index));

const magnitudes = ([real, imag]: [number[], number[]]) => real.map((a, k) => Math.hypot(a, imag[k]));

describe('wavetable mipmap', () => {
  it('keeps a third of an octave fewer harmonics on each level, on the grid of a native PeriodicWave', () => {
    const counts = levelHarmonics(1023);
    // Chrome: floor(2048 · 2^(-r/3)) partials, 1023 at most
    expect(counts.slice(0, 6)).toEqual([1023, 812, 645, 512, 406, 322]);
    counts
      .slice(1, -1)
      .forEach((count, r) => expect(count).toBe(Math.floor(2048 * 2 ** (-(r + 4) / 3) + 1e-9)));
    expect(counts.at(-2)).toBe(1);
    expect(counts.at(-1)).toBe(0);
    // a frame of 16 samples: the grid of 8
    expect(levelHarmonics(7).slice(0, 4)).toEqual([7, 6, 5, 4]);
    // the placeholder sine: one harmonic up to a third of an octave below the nyquist
    expect(levelHarmonics(1)).toEqual([1, 1, 1, 1, 0]);
  });

  it('plays only the harmonics of its level', () => {
    const levels = buildLevels([saw()]);
    for (const level of [0, 3, 10, 20, levels.harmonics.length - 2]) {
      const count = levels.harmonics[level];
      const spectrum = magnitudes(spectrumOf(levels, level, 0));
      expect(spectrum[count]).toBeGreaterThan(1e-4);
      spectrum.slice(count + 1).forEach((value) => expect(value).toBeLessThan(1e-6));
    }
    frameOf(levels, levels.harmonics.length - 1, 0).forEach((value) => expect(value).toBe(0));
  });

  it('makes a level 32 samples per cycle of its highest harmonic long, 512 to 4096', () => {
    expect(levelLength(1023)).toBe(4096);
    expect(levelLength(128)).toBe(4096);
    expect(levelLength(127)).toBe(4096);
    expect(levelLength(64)).toBe(2048);
    expect(levelLength(63)).toBe(2048);
    expect(levelLength(16)).toBe(512);
    expect(levelLength(8)).toBe(512);
    expect(levelLength(0)).toBe(1);
    const { lengths, harmonics } = buildLevels([saw()]);
    lengths.forEach((length, r) => expect(length).toBe(levelLength(harmonics[r])));
  });

  it('drops DC and the nyquist bin of a frame', () => {
    const frame = cycle(16, [[1, 0.5]]).map((value, n) => value + 0.3 + 0.2 * (n % 2 ? -1 : 1));
    const levels = buildLevels([frame]);
    const level0 = frameOf(levels, 0, 0);
    const mean = level0.reduce((sum, value) => sum + value, 0) / level0.length;
    expect(mean).toBeCloseTo(0, 6);
    // only the sine is left, at its amplitude
    expect(Math.max(...level0)).toBeCloseTo(0.5, 4);
    expect(magnitudes(spectrumOf(levels, 0, 0))[1]).toBeCloseTo(0.5, 4);
  });

  it('plays every level of a frame at the volume of the frame (not normalized)', () => {
    const quiet = saw().map((value) => value * 0.1);
    const levels = buildLevels([quiet, saw()]);
    const peaks = [0, 1].map((index) => Math.max(...frameOf(levels, 0, index).map(Math.abs)));
    expect(peaks[0]).toBeCloseTo(0.1 * peaks[1], 5);
    for (const index of [0, 1]) {
      const reference = magnitudes(spectrumOf(levels, 0, index));
      for (const level of [1, 5, 15]) {
        const spectrum = magnitudes(spectrumOf(levels, level, index));
        for (let k = 1; k <= levels.harmonics[level]; k++) expect(spectrum[k]).toBeCloseTo(reference[k], 5);
      }
    }
  });

  it('keeps the phases of the harmonics', () => {
    const frame = cycle(2048, [
      [1, 1, 0.3],
      [2, 0.5, 2],
      [7, 0.25, -1],
    ]);
    const levels = buildLevels([frame]);
    const [real, imag] = wave.realWithImag(frame);
    for (const level of [0, 12, levels.harmonics.length - 8]) {
      const [levelReal, levelImag] = spectrumOf(levels, level, 0);
      for (const k of [1, 2, 7].filter((h) => h <= levels.harmonics[level])) {
        expect(levelReal[k]).toBeCloseTo(real[k], 4);
        expect(levelImag[k]).toBeCloseTo(imag[k], 4);
      }
    }
  });

  it('puts the last sample of a frame before it and its first two after it', () => {
    const levels = buildLevels([saw(), cycle(2048, [[3, 1]])]);
    levels.lengths.forEach((length, r) =>
      [0, 1].forEach((index) => {
        const frame = guardedFrameOf(levels, r, index);
        expect(frame[0]).toBe(frame[length]);
        expect(frame[length + 1]).toBe(frame[1]);
        expect(frame[length + 2]).toBe(frame[2]);
      })
    );
  });

  it('rebuilds one frame and keeps the others', () => {
    const levels = buildLevels([saw(), saw(), saw()]);
    const before = levels.data.slice();
    const sine = cycle(2048, [[1, 1]]);

    writeFrame(levels, 1, sine);

    const expected = buildLevels([sine]);
    levels.lengths.forEach((_, r) => {
      expect([...guardedFrameOf(levels, r, 1)]).toEqual([...guardedFrameOf(expected, r, 0)]);
      for (const index of [0, 2]) {
        const start = frameStart(levels, r, index);
        expect([...guardedFrameOf(levels, r, index)]).toEqual([
          ...before.subarray(start, start + levels.lengths[r] + 3),
        ]);
      }
    });
  });

  it('builds frames of 16 to 2048 samples, a short one has fewer harmonics and shorter levels', () => {
    for (const size of [16, 64, 256, 2048]) {
      const levels = buildLevels([saw(size)]);
      expect(levels.harmonics[0]).toBe(size / 2 - 1);
      expect(levels.lengths[0]).toBe(levelLength(size / 2 - 1));
      expect(magnitudes(spectrumOf(levels, 0, 0)).slice(1, size / 2)).toEqual(
        Array.from({ length: size / 2 - 1 }, () => expect.any(Number))
      );
    }
    expect(buildLevels([saw(16)]).lengths[0]).toBe(512);
  });

  it('gives the frames of a table the harmonics of its richest frame', () => {
    const levels = buildLevels([saw(16), saw(2048)]);
    expect(levels.harmonics[0]).toBe(1023);
    const short = magnitudes(spectrumOf(levels, 0, 0));
    expect(short[7]).toBeGreaterThan(0.01);
    short.slice(8).forEach((value) => expect(value).toBeLessThan(1e-6));
  });

  it('plays a sine from the 4 samples of the placeholder wave', () => {
    const levels = buildLevels([[0, 1, 0, -1]]);
    expect([...levels.harmonics]).toEqual([1, 1, 1, 1, 0]);
    const level = frameOf(levels, 0, 0);
    expect(level[levels.lengths[0] / 4]).toBeCloseTo(1, 6);
  });

  it('keeps at most 256 frames, a table of 256 frames of 2048 samples takes at most 64 MiB', () => {
    const layout = createLevels(MAX_FRAMES, 1023);
    expect(layout.data.byteLength).toBeLessThanOrEqual(64 * 2 ** 20);
    const frames = Array.from({ length: MAX_FRAMES + 2 }, () => [0, 1, 0, -1]);
    expect(buildLevels(frames).frames).toBe(MAX_FRAMES);
  });

  it('reuses a buffer of the size the table needs', () => {
    const first = buildLevels([saw()]);
    const reused = buildLevels([cycle(2048, [[2, 1]])], first.data.buffer);
    expect(reused.data.buffer).toBe(first.data.buffer);
    expect(buildLevels([saw(16)], first.data.buffer).data.buffer).not.toBe(first.data.buffer);
  });
});
