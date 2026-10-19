// the verdicts of the perf suite (node --test): Mann–Whitney, the regressions, the conditions, the baseline merge
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { conditionChanges, drift, mannWhitney, mergeMode, regression } from './verdict.mjs';

// a seeded random() (mulberry32), noise around a value
const seeded = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const noisy = (count, center, spread, random) =>
  Array.from({ length: count }, () => center + spread * (random() - 0.5));

// the exact p of a rank sum this large or larger without ties, by counting the subsets of 1..n
const exactP = (current, base) => {
  const all = [...current, ...base].sort((a, b) => a - b);
  const sum = current.reduce((total, value) => total + all.indexOf(value) + 1, 0);
  const n = all.length;
  const k = current.length;
  let ways = Array.from({ length: k + 1 }, () => new Map());
  ways[0].set(0, 1);
  for (let r = 1; r <= n; r++)
    for (let j = Math.min(k, r); j >= 1; j--)
      for (const [s, count] of ways[j - 1]) ways[j].set(s + r, (ways[j].get(s + r) ?? 0) + count);
  let atLeast = 0;
  let total = 0;
  for (const [s, count] of ways[k]) {
    total += count;
    if (s >= sum) atLeast += count;
  }
  return atLeast / total;
};

describe('mannWhitney', () => {
  it('is exact for small groups: 5 above 5 is one arrangement of 252', () => {
    assert.ok(Math.abs(mannWhitney([6, 7, 8, 9, 10], [1, 2, 3, 4, 5]).p - 1 / 252) < 1e-12);
    // one-sided: below the baseline is no regression
    assert.ok(mannWhitney([1, 2, 3, 4, 5], [6, 7, 8, 9, 10]).p > 0.99);
  });

  it('counts ties at their mean ranks', () => {
    assert.ok(Math.abs(mannWhitney([2, 2, 2, 2, 2], [1, 1, 1, 1, 1]).p - 1 / 252) < 1e-12);
    // the same values: no evidence either way
    assert.ok(mannWhitney([1, 2, 3, 4, 5], [1, 2, 3, 4, 5]).p > 0.4);
    assert.equal(mannWhitney([1, 1, 1], [1, 1, 1]).p, 1);
  });

  it('agrees with the exact distribution where it takes the normal approximation', () => {
    const random = seeded(3);
    const base = noisy(11, 10, 4, random);
    const current = noisy(11, 11, 4, random);
    const { p } = mannWhitney(current, base);
    assert.ok(Math.abs(p - exactP(current, base)) < 0.01, `${p} vs ${exactP(current, base)}`);
  });

  it('tells a shift of the notes apart, not noise alone', () => {
    const random = seeded(7);
    const base = noisy(50, 5, 2, random);
    assert.ok(mannWhitney(noisy(50, 5.8, 2, random), base).p < 0.01);
    assert.ok(mannWhitney(noisy(50, 5, 2, random), base).p > 0.01);
  });

  it('ignores values that are not numbers, gives no p without values', () => {
    assert.ok(Math.abs(mannWhitney([6, 7, 8, 9, 10, null, NaN], [1, 2, 3, 4, 5]).p - 1 / 252) < 1e-12);
    assert.equal(mannWhitney([], [1, 2]).p, null);
  });
});

describe('regression', () => {
  const AUDIO = { metric: 'audio thread', unit: 'Mcps', alpha: 0.05, rel: 0.05, abs: 2, min: 5 };
  const base = [100, 101, 99, 100.5, 99.5];

  it('fails a shift the runs tell apart and larger than the thresholds', () => {
    const found = regression([110, 111, 109, 110.5, 109.5], base, AUDIO);
    assert.equal(found.level, 'fail');
    assert.match(
      found.message,
      /audio thread median 110\.00 Mcps \(reference 100\.00, \+10\.00 Mcps, \+10\.0%/
    );
  });

  it("passes a shift the runs tell apart under the thresholds, and one they don't", () => {
    // +3%: under 5%
    assert.equal(regression([103, 104, 102, 103.5, 102.5], base, AUDIO), null);
    // +6% in the median, but the runs overlap
    assert.equal(regression([90, 106, 120, 95, 108], base, AUDIO), null);
    // +7.5% of 4 Mcps: 0.3 Mcps, under the floor of 2
    assert.equal(regression([4.3, 4.31, 4.29, 4.305, 4.295], [4, 4.01, 3.99, 4.005, 3.995], AUDIO), null);
  });

  it('warns instead when only a warning is due', () => {
    assert.equal(regression([110, 111, 109, 110.5, 109.5], base, { ...AUDIO, warnOnly: true }).level, 'warn');
  });

  it('warns that it could not compare with too few values on a side', () => {
    const found = regression([110, 111, 109], base, AUDIO);
    assert.equal(found.level, 'warn');
    assert.match(found.message, /too few values to compare \(3 now, 5 of the reference, 5 needed\)/);
    assert.equal(regression([110, 111, 109, 110, 112], [100, null, NaN, 99, 101], AUDIO).level, 'warn');
  });

  it('counts an absolute shift of the latency without a relative one', () => {
    const random = seeded(11);
    const notes = noisy(50, 4, 1, random);
    const options = { metric: 'to voice', unit: 'ms', alpha: 0.01, abs: 0.5, min: 20 };
    assert.equal(regression(noisy(50, 5, 1, random), notes, options).level, 'fail');
    assert.equal(regression(noisy(50, 4.3, 1, random), notes, options), null);
  });
});

describe('drift', () => {
  const AUDIO = { metric: 'audio thread', unit: 'Mcps', rel: 0.15, abs: 5 };
  const base = [100, 101, 99, 100.5, 99.5];

  it('warns of a median moved by more than a session drifts', () => {
    assert.match(
      drift([120, 121, 119, 118, 122], base, AUDIO),
      /audio thread median 120\.00 Mcps, 100\.00 in the baseline \(\+20\.00 Mcps, \+20\.0%\): drift or a regression/
    );
  });

  it('takes a shift a session drifts by, or under the floor, for none; nothing without values', () => {
    // +8.5%: the heavy patch on the same code in two sessions
    assert.equal(drift([108.5, 109, 108, 108.5, 108.5], base, AUDIO), null);
    assert.equal(drift([24, 24, 24], [20, 20, 20], AUDIO), null);
    assert.equal(drift([], base, AUDIO), null);
  });
});

describe('conditions', () => {
  const output = { name: 'External Headphones', transport: 'coreaudio_device_type_builtin', rate: 48000 };
  const base = { version: '133.0', os: '26.6.2', output };

  it('counts the macOS release, the transport and the rate of the output', () => {
    assert.deepEqual(
      conditionChanges({ os: '26.6.3', output: { ...output, name: 'MacBook Speakers' } }, base),
      {
        changes: [],
        unknown: [],
      }
    );
    const { changes } = conditionChanges({ os: '26.7', output: { ...output, rate: 44100 } }, base);
    assert.deepEqual(changes, [
      'macOS 26.6 in the baseline, 26.7 now',
      'output rate 48000 Hz in the baseline, 44100 Hz now',
    ]);
  });

  it('tells an unknown output apart from a changed one', () => {
    assert.deepEqual(conditionChanges({ os: '26.6.2', output: null }, base), {
      changes: [],
      unknown: ['output transport', 'output rate'],
    });
    assert.deepEqual(conditionChanges({ os: '26.6.2', output }, { ...base, output: undefined }).changes, []);
  });
});

describe('mergeMode', () => {
  const output = { name: 'Speakers', transport: 'builtin', rate: 48000 };
  const before = {
    version: '133.0',
    os: '26.6.2',
    output,
    cases: { S5: { audio: [1, 2, 3, 4, 5] }, L1: { toVoice: [1] }, L3: { toVoice: [2] } },
  };

  it('keeps the cases a run did not measure under the same browser and conditions, and a known output', () => {
    const { mode, dropped } = mergeMode(before, {
      version: '133.0',
      conditions: { os: '26.6.4', output: null },
      cases: { L1: { toVoice: [9] } },
    });
    assert.deepEqual(mode, {
      version: '133.0',
      os: '26.6.4',
      output,
      cases: { S5: { audio: [1, 2, 3, 4, 5] }, L1: { toVoice: [9] }, L3: { toVoice: [2] } },
    });
    assert.deepEqual(dropped, []);
  });

  it('drops them under another browser version or other conditions', () => {
    const conditions = { os: '26.6.2', output };
    const other = mergeMode(before, { version: '134.0', conditions, cases: { L1: { toVoice: [9] } } });
    assert.deepEqual(other.mode.cases, { L1: { toVoice: [9] } });
    assert.deepEqual(other.dropped, ['S5', 'L3']);
    const rate = mergeMode(before, {
      version: '133.0',
      conditions: { os: '26.6.2', output: { ...output, rate: 96000 } },
      cases: {},
    });
    assert.deepEqual(rate.dropped, ['S5', 'L1', 'L3']);
  });

  it('starts a mode the baseline has not', () => {
    const { mode, dropped } = mergeMode(undefined, {
      version: '18.2',
      conditions: { os: '26.6.2', output },
      cases: { S5: { audio: [1] } },
    });
    assert.deepEqual(mode.cases, { S5: { audio: [1] } });
    assert.deepEqual(dropped, []);
  });
});
