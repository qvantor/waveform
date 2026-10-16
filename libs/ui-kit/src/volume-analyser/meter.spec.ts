import { createPeakHold, dbToHeight, FFT_SIZE, levels, METER, toDb, zoneStops } from './meter';

const CEILING_DB = -0.5; // the master limiter's ceiling
const fromDb = (db: number) => 10 ** (db / 20);

const sine = (amplitude: number, periods = 7) =>
  Float32Array.from(
    { length: FFT_SIZE },
    (_, i) => amplitude * Math.sin((2 * Math.PI * periods * i) / FFT_SIZE)
  );

const square = (amplitude: number) =>
  Float32Array.from({ length: FFT_SIZE }, (_, i) => (i % 64 < 32 ? amplitude : -amplitude));

describe('levels', () => {
  it('reads a sine at the limiter ceiling as -3.5 dB rms and -0.5 dB peak', () => {
    const { rms, peak } = levels(sine(fromDb(CEILING_DB)));
    expect(toDb(rms)).toBeCloseTo(CEILING_DB - 3.01, 2);
    expect(toDb(peak)).toBeCloseTo(CEILING_DB, 2);
  });

  it('reads the peak of a negative half wave', () => {
    expect(levels(Float32Array.from([0, -0.5, 0.25])).peak).toBe(0.5);
  });

  it('reads a square wave with the rms equal to the peak', () => {
    const { rms, peak } = levels(square(0.5));
    expect(rms).toBeCloseTo(0.5, 6);
    expect(peak).toBeCloseTo(0.5, 6);
  });

  it('reads silence and an empty window as zero', () => {
    expect(levels(new Float32Array(FFT_SIZE))).toEqual({ rms: 0, peak: 0 });
    expect(levels(new Float32Array(0))).toEqual({ rms: 0, peak: 0 });
  });
});

describe('toDb', () => {
  it('converts a gain to dBFS, silence to -Infinity', () => {
    expect(toDb(1)).toBe(0);
    expect(toDb(0.5)).toBeCloseTo(-6.02, 2);
    expect(toDb(0)).toBe(-Infinity);
  });
});

describe('dbToHeight', () => {
  it('maps the scale from minDb (the bottom) to 0 dBFS (the top) linearly in dB', () => {
    expect(dbToHeight(0, 60)).toBe(60);
    expect(dbToHeight(METER.minDb / 2, 60)).toBe(30);
    expect(dbToHeight(METER.minDb, 60)).toBe(0);
  });

  it('keeps silence, levels below the scale and NaN at the bottom', () => {
    expect(dbToHeight(-Infinity, 60)).toBe(0);
    expect(dbToHeight(METER.minDb - 20, 60)).toBe(0);
    expect(dbToHeight(NaN, 60)).toBe(0);
  });

  it('keeps levels above 0 dBFS at the top', () => {
    expect(dbToHeight(6, 60)).toBe(60);
  });

  // the old linear meter showed the loudest sine (rms 0.67) at 53% of the clip line
  it('shows a sine at the limiter ceiling near the top', () => {
    expect(dbToHeight(CEILING_DB - 3.01, 60)).toBeCloseTo(55.6, 1);
    expect(dbToHeight(CEILING_DB, 60)).toBeCloseTo(59.4, 1);
  });
});

describe('createPeakHold', () => {
  it('rises to a higher peak at once', () => {
    const hold = createPeakHold();
    expect(hold(-20, 0)).toBe(-20);
    expect(hold(-6, 0.016)).toBe(-6);
  });

  it(`holds the peak for ${METER.peakHold} s`, () => {
    const hold = createPeakHold();
    hold(-6, 0);
    expect(hold(-30, 0.5)).toBe(-6);
    expect(hold(-30, METER.peakHold)).toBe(-6);
  });

  it(`then falls ${METER.peakFall} dB/s, measured by time, not frames`, () => {
    const hold = createPeakHold();
    hold(-6, 0);
    // one frame half a second after the hold ended
    expect(hold(-40, METER.peakHold + 0.5)).toBeCloseTo(-6 - METER.peakFall * 0.5);
    // the next frames fall from there
    expect(hold(-40, METER.peakHold + 0.6)).toBeCloseTo(-6 - METER.peakFall * 0.6);
  });

  it('counts the fall from the end of the hold when frames came during it', () => {
    const hold = createPeakHold();
    hold(-6, 0);
    hold(-40, 0.9);
    expect(hold(-40, METER.peakHold + 0.25)).toBeCloseTo(-6 - METER.peakFall * 0.25);
  });

  it('never falls below the current peak', () => {
    const hold = createPeakHold();
    hold(-6, 0);
    expect(hold(-10, 5)).toBe(-10);
    expect(hold(-10, 6)).toBe(-10);
  });

  it('holds a new, lower peak once the old one has fallen to it', () => {
    const hold = createPeakHold();
    hold(-6, 0);
    expect(hold(-10, 5)).toBe(-10);
    expect(hold(-30, 5.5)).toBe(-10);
    expect(hold(-30, 6.5)).toBeCloseTo(-10 - METER.peakFall * 0.5);
  });

  it('stays at -Infinity in silence', () => {
    const hold = createPeakHold();
    expect(hold(-Infinity, 0)).toBe(-Infinity);
    expect(hold(-Infinity, 3)).toBe(-Infinity);
  });
});

describe('zoneStops', () => {
  it(`is green below ${METER.warnDb} dB, yellow up to ${METER.hotDb} dB, red above`, () => {
    const warn = dbToHeight(METER.warnDb, 1);
    const hot = dbToHeight(METER.hotDb, 1);
    expect(zoneStops()).toEqual([
      [0, 'normal'],
      [warn, 'normal'],
      [warn, 'warn'],
      [hot, 'warn'],
      [hot, 'hot'],
      [1, 'hot'],
    ]);
    expect(warn).toBe(0.75);
    expect(hot).toBeCloseTo(0.9375);
  });
});
