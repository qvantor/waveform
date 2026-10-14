import { biquad } from '@waveform/math';
import {
  HF_RATIO,
  LINE_TIMES,
  lineDecay,
  lineFactor,
  LOOP_ALLPASS_TIMES,
  loopLength,
  MIN_MODAL_OVERLAP,
  sizeFactor,
  XOVER,
} from './reverb-decay';

describe('lineDecay', () => {
  it('loses 60 dB over the decay time at the mids', () => {
    const length = 0.05;
    const { gain } = lineDecay(length, 2, 1);
    const passes = 2 / length;
    expect(20 * Math.log10(gain ** passes)).toBeCloseTo(-60);
  });

  it('the lowshelf makes the lows ring decay × bass', () => {
    const length = 0.05;
    [0.25, 0.5, 2, 4].forEach((bass) => {
      const { gain, lowDb } = lineDecay(length, 2, bass);
      const lowPassDb = 20 * Math.log10(gain) + lowDb;
      expect((-60 * length) / lowPassDb).toBeCloseTo(2 * bass);
    });
    expect(lineDecay(length, 2, 1).lowDb).toBe(0);
  });

  it('the highshelf makes the highs ring decay × HF_RATIO, at most -40 dB per pass', () => {
    const { gain, highDb } = lineDecay(0.05, 2, 1);
    expect((-60 * 0.05) / (20 * Math.log10(gain) + highDb)).toBeCloseTo(2 * HF_RATIO);
    expect(lineDecay(0.09, 0.1, 1).highDb).toBe(-40);
  });

  it('sizeFactor spans 0.3..1.5', () => {
    expect(sizeFactor(0)).toBe(0.3);
    expect(sizeFactor(1)).toBe(1.5);
  });

  // the gain and the shelves are computed together: whatever the values, a pass never gains
  it('a pass never gains at any frequency', () => {
    const sampleRate = 48000;
    [0.1, 0.5, 20].forEach((decay) =>
      [0.25, 1, 4].forEach((bass) =>
        [500, 20000].forEach((damp) => {
          const { gain, lowDb, highDb } = lineDecay(loopLength(15, 1.5), decay, bass);
          const low = biquad.coefficients('lowshelf', { frequency: XOVER, Q: 0, gain: lowDb }, sampleRate);
          const high = biquad.coefficients('highshelf', { frequency: damp, Q: 0, gain: highDb }, sampleRate);
          [10, 100, 300, 1000, 5000, 15000, 23000].forEach((freq) => {
            const passDb =
              20 * Math.log10(gain) +
              biquad.magnitudeDb(low, freq, sampleRate) +
              biquad.magnitudeDb(high, freq, sampleRate);
            expect(passDb).toBeLessThan(0);
          });
        })
      )
    );
  });
});

describe('lines', () => {
  it('16 lines, each with its own allpass, no two lengths alike', () => {
    expect(LINE_TIMES).toHaveLength(16);
    expect(LOOP_ALLPASS_TIMES).toHaveLength(16);
    expect(new Set(LINE_TIMES).size).toBe(16);
    expect(new Set(LOOP_ALLPASS_TIMES).size).toBe(16);
  });

  it('a loop is the line and its allpass, scaled by the room', () => {
    expect(loopLength(0, 1)).toBeCloseTo(LINE_TIMES[0] + LOOP_ALLPASS_TIMES[0]);
    expect(loopLength(3, 0.5)).toBeCloseTo((LINE_TIMES[3] + LOOP_ALLPASS_TIMES[3]) * 0.5);
  });

  it('the lines follow the size while the decay is short', () => {
    [0, 0.5, 1].forEach((size) => expect(lineFactor(size, 2)).toBe(sizeFactor(size)));
    expect(lineFactor(1, 8)).toBe(sizeFactor(1));
  });

  // the modes are 1 / (all loops) Hz apart and 2.2 / decay Hz wide
  it('a long decay grows the lines of a small room, so its modes keep overlapping', () => {
    const overlap = (size: number, decay: number) =>
      (2.2 / decay) * LINE_TIMES.reduce((sum, _, i) => sum + loopLength(i, lineFactor(size, decay)), 0);
    expect(lineFactor(0, 8)).toBeGreaterThan(sizeFactor(0));
    expect(lineFactor(0, 20)).toBeGreaterThan(lineFactor(0, 8));
    [0, 0.3, 1].forEach((size) =>
      [0.1, 2, 8, 20].forEach((decay) =>
        expect(overlap(size, decay)).toBeGreaterThanOrEqual(MIN_MODAL_OVERLAP - 1e-9)
      )
    );
  });
});
