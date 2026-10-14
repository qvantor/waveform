import { HF_RATIO, lineDecay, sizeFactor } from './reverb-decay';

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
});
