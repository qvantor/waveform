import { createTruePeak, OVERSAMPLING, TRUE_PEAK_BOUND, TRUE_PEAK_DELAY, TRUE_PEAK_TAPS } from './true-peak';

const db = (gain: number) => 20 * Math.log10(gain);

// the readings of a detector fed with the samples, one per sample
const read = (samples: number[], threshold?: number) => {
  const next = createTruePeak(threshold);
  return samples.map((sample) => next(sample));
};

// deterministic white noise
const noise = (length: number) => {
  let seed = 1;
  return Array.from({ length }, () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647) * 2 - 1;
  });
};

// a full scale sine, `freq` in cycles per sample
const sine = (freq: number, length: number, phase = 0) =>
  Array.from({ length }, (_, n) => Math.sin(2 * Math.PI * freq * n + phase));

describe('createTruePeak', () => {
  it('reads an impulse at its level DELAY samples later, never above it', () => {
    const readings = read([1, ...new Array(2 * TRUE_PEAK_TAPS).fill(0)]);
    expect(readings[TRUE_PEAK_DELAY]).toBe(1);
    expect(Math.max(...readings)).toBe(1);
  });

  it('is never below the sample peak: phase 0 is the input itself, DELAY samples back', () => {
    const samples = noise(2000);
    const readings = read(samples);
    for (let n = TRUE_PEAK_DELAY; n < samples.length; n++)
      expect(readings[n]).toBeGreaterThanOrEqual(Math.abs(samples[n - TRUE_PEAK_DELAY]));
  });

  it('reads DC exactly', () => {
    const readings = read(new Array(100).fill(0.5));
    readings.slice(TRUE_PEAK_TAPS).forEach((reading) => expect(reading).toBeCloseTo(0.5, 12));
  });

  it('finds the peak between the samples: a full scale sine at fs/4 sampled at ±45° reads full scale', () => {
    const samples = sine(1 / 4, 200, Math.PI / 4);
    expect(Math.max(...samples)).toBeCloseTo(Math.SQRT1_2, 10);
    // a reading covers one sample interval, every other one holds a peak (+ or -)
    const readings = read(samples).slice(2 * TRUE_PEAK_TAPS);
    for (let n = 0; n + 1 < readings.length; n++)
      expect(Math.abs(db(Math.max(readings[n], readings[n + 1])))).toBeLessThan(0.03);
  });

  // a peak is at most 1/8 of a sample away from the 4× grid: it reads at most cos(π·freq/4) below its
  // level, plus the ripple of the phases; it never reads more than the ripple above it
  it.each([0.02, 0.1, 0.2, 0.3, 0.4, 0.45])(
    'a full scale sine at %s·fs reads within the 4× grid error of its peak in every cycle',
    (freq) => {
      const period = Math.ceil(1 / freq);
      [0, 0.3, 1.1, 2.5].forEach((phase) => {
        const readings = read(sine(freq, 600, phase)).slice(2 * TRUE_PEAK_TAPS);
        expect(Math.max(...readings)).toBeLessThan(10 ** (0.03 / 20));
        const floor = Math.cos((Math.PI * freq) / OVERSAMPLING) * 10 ** (-0.03 / 20);
        for (let start = 0; start + period <= readings.length; start += period)
          expect(Math.max(...readings.slice(start, start + period))).toBeGreaterThan(floor);
      });
    }
  );

  describe('with a threshold', () => {
    const THRESHOLD = 0.9;

    it('reads every peak from the threshold up exactly, skips only what can not reach it', () => {
      // noise fading in from -40 dB to 6 dB over full scale and back: quiet, around the threshold and loud
      const random = noise(6000);
      const samples = random.map(
        (value, n) => value * 10 ** ((-40 + 46 * Math.sin((Math.PI * n) / 6000)) / 20)
      );
      const exact = read(samples);
      const skipping = read(samples, THRESHOLD);
      let skipped = 0;
      for (let n = TRUE_PEAK_DELAY; n < samples.length; n++) {
        if (exact[n] >= THRESHOLD) expect(skipping[n]).toBe(exact[n]);
        else expect(skipping[n]).toBeLessThan(THRESHOLD);
        expect(skipping[n]).toBeGreaterThanOrEqual(Math.abs(samples[n - TRUE_PEAK_DELAY]));
        if (skipping[n] !== exact[n]) skipped++;
      }
      // the quiet parts are skipped
      expect(skipped).toBeGreaterThan(samples.length / 5);
    });

    // a point between the samples is at most TRUE_PEAK_BOUND times the loudest sample around it: it is
    // that much when the samples have the signs of the taps of the half sample phase
    it(`skips samples below threshold / ${TRUE_PEAK_BOUND.toFixed(
      3
    )} (8.1 dB): the worst case stays below it`, () => {
      expect(db(TRUE_PEAK_BOUND)).toBeCloseTo(8.1, 1);
      const level = (0.999 * THRESHOLD) / TRUE_PEAK_BOUND;
      // the sample written j steps ago at the last reading has the sign of tap j of the half sample phase
      const worst = Array.from({ length: TRUE_PEAK_TAPS }, (_, i) => {
        const j = TRUE_PEAK_TAPS - 1 - i;
        return (
          level * Math.sign(Math.sin(Math.PI * (j - TRUE_PEAK_DELAY + 0.5)) / (j - TRUE_PEAK_DELAY + 0.5))
        );
      });
      const exact = read(worst).at(-1) ?? NaN;
      expect(exact).toBeLessThan(THRESHOLD);
      expect(exact).toBeGreaterThan(0.99 * THRESHOLD);
      expect(read(worst, THRESHOLD).at(-1)).toBe(level);
    });

    it('a sample at the quiet level makes it read exactly for the next TAPS readings', () => {
      const quiet = THRESHOLD / TRUE_PEAK_BOUND;
      const samples = [
        ...noise(64).map((value) => value * quiet * 0.5),
        quiet,
        ...noise(80).map((value) => value * quiet * 0.5),
      ];
      const exact = read(samples);
      const skipping = read(samples, THRESHOLD);
      const loud = 64;
      expect(skipping.slice(loud, loud + TRUE_PEAK_TAPS)).toEqual(exact.slice(loud, loud + TRUE_PEAK_TAPS));
      // before and after, a skipped reading is the center sample
      [loud - 1, loud + TRUE_PEAK_TAPS].forEach((n) =>
        expect(skipping[n]).toBe(Math.abs(samples[n - TRUE_PEAK_DELAY]))
      );
      expect(skipping.slice(loud + TRUE_PEAK_TAPS)).not.toEqual(exact.slice(loud + TRUE_PEAK_TAPS));
    });

    it('a threshold of 0 never skips', () => {
      const samples = noise(500).map((value) => value * 1e-6);
      expect(read(samples, 0)).toEqual(read(samples));
    });
  });
});
