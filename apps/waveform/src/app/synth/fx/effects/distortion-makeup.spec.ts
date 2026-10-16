import { FX_PARAMS } from '@waveform/preset-schema';
import { makeupGain, MAX_DRIVE, REFERENCE_PEAK } from './distortion-makeup';
import { DISTORTION_MODES } from './distortion-modes';

const [SOFT, HARD] = DISTORTION_MODES.map((_, i) => i);
const db = (gain: number) => 20 * Math.log10(gain);

// the RMS of a sine of `peak` through the curve of the mode at the drive, with its makeup gain
const outputRms = (mode: number, drive: number, peak: number, points = 4096) => {
  const { shape } = DISTORTION_MODES[mode];
  const gain = 10 ** (drive / 20);
  const makeup = makeupGain(mode, drive);
  let sum = 0;
  for (let i = 0; i < points; i++) {
    const y = makeup * shape(gain * peak * Math.sin((2 * Math.PI * i) / points));
    sum += y * y;
  }
  return Math.sqrt(sum / points);
};

const DRIVES = [0, 1.3, 6, 6.1, 9.87, 11.2, 12];

describe('distortion makeup gain', () => {
  it('covers the drive range of the preset schema', () => {
    expect(MAX_DRIVE).toBe(FX_PARAMS.distortion.drive.max);
    expect(FX_PARAMS.distortion.drive.min).toBe(0);
  });

  it.each([
    ['soft', SOFT],
    ['hard', HARD],
  ])('%s clip: the reference keeps its loudness at every drive', (_, mode) => {
    DRIVES.forEach((drive) =>
      expect(
        Math.abs(db(outputRms(mode, drive, REFERENCE_PEAK) / (REFERENCE_PEAK / Math.SQRT2)))
      ).toBeLessThan(0.02)
    );
  });

  it('is 1:1 with the drive while the reference passes the hard clip unclipped', () => {
    expect(makeupGain(HARD, 0)).toBeCloseTo(1, 12);
    // the reference reaches the ceiling at +6.02 dB
    [1, 3, 5.5, 6].forEach((drive) => expect(db(makeupGain(HARD, drive))).toBeCloseTo(-drive, 2));
    expect(db(makeupGain(HARD, 12))).toBeGreaterThan(-12 + 3);
  });

  it('levels off once the reference is clipped: towards the RMS of a square of ±1', () => {
    const square = db(REFERENCE_PEAK / Math.SQRT2);
    [SOFT, HARD].forEach((mode) => {
      expect(db(makeupGain(mode, MAX_DRIVE))).toBeGreaterThan(square);
      // the last 3 dB of drive take back less than half of it (1:1 while unclipped)
      expect(db(makeupGain(mode, MAX_DRIVE - 3)) - db(makeupGain(mode, MAX_DRIVE))).toBeLessThan(1.5);
    });
  });

  it('more drive never makes it louder', () => {
    [SOFT, HARD].forEach((mode) => {
      for (let drive = 0.1; drive <= MAX_DRIVE; drive += 0.1) {
        expect(makeupGain(mode, drive)).toBeLessThanOrEqual(makeupGain(mode, drive - 0.1) + 1e-12);
      }
    });
  });

  it('soft clip lifts the reference a little without drive: tanh bends it already', () => {
    expect(db(makeupGain(SOFT, 0))).toBeGreaterThan(0.3);
    expect(db(makeupGain(SOFT, 0))).toBeLessThan(0.7);
  });

  it('louder sounds come out quieter, quieter ones louder: the curve compresses them', () => {
    const change = (peak: number) => db(outputRms(HARD, MAX_DRIVE, peak) / (peak / Math.SQRT2));
    expect(change(1)).toBeLessThan(-5);
    expect(change(0.25)).toBeGreaterThan(3);
  });

  it('clamps the drive to its range and the mode to the known ones', () => {
    expect(makeupGain(HARD, -5)).toBe(makeupGain(HARD, 0));
    expect(makeupGain(HARD, 50)).toBe(makeupGain(HARD, MAX_DRIVE));
    expect(makeupGain(7, 12)).toBe(makeupGain(HARD, 12));
    expect(makeupGain(-1, 12)).toBe(makeupGain(SOFT, 12));
  });
});
