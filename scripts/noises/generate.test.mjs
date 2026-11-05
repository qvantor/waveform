import assert from 'node:assert/strict';
import { test } from 'node:test';

import { biquad, db, filtered, highpass, processSound } from './dsp.mjs';
import { generate } from './generate.mjs';

const RATE = 44100;
const power = (c) => c.reduce((s, v) => s + v * v, 0) / c.length;
// The power of a band around hz (constant Q; 4 bandpasses: a steep spectrum leaks little through), in dB.
const band = (c, hz) =>
  10 * Math.log10(power([0, 1, 2, 3].reduce((x) => filtered(x, biquad('bandpass', hz, 1.41, RATE)), c)));

test('the same params make the same samples', () => {
  for (const spec of [
    { type: 'noise', color: 'pink', seconds: 0.2, seed: 3 },
    { type: 'partials', f0: 300, random: { count: 5, low: 300, high: 3000 }, seconds: 0.2, seed: 4 },
    { type: 'kick', start: 300, end: 50, sweepMs: 10, click: 'noise', seed: 5 },
  ]) {
    const [a, b] = [generate(spec, RATE), generate(spec, RATE)];
    assert.deepEqual(a, b);
  }
  assert.notDeepEqual(
    generate({ type: 'noise', seconds: 0.1, seed: 1 }, RATE),
    generate({ type: 'noise', seconds: 0.1, seed: 2 }, RATE)
  );
});

test('the colors of noise: 3 octaves up a band of white is 9 dB louder, of pink as loud, of brown 9 dB softer', () => {
  // constant-Q bands: +3 dB per octave over the slope of the color
  for (const [color, slope] of [
    ['white', 0],
    ['pink', -3],
    ['brown', -6],
    ['blue', 3],
    ['violet', 6],
  ]) {
    const [c] = generate({ type: 'noise', color, seconds: 4, seed: 9 }, RATE);
    const rise = band(c, 4000) - band(c, 500);
    assert.ok(Math.abs(rise - 3 * (slope + 3)) < 2, `${color}: ${rise.toFixed(1)} dB`);
  }
});

test('a highpass takes 24 dB an octave under its frequency and passes what is over it', () => {
  const sine = (hz) => [
    Float32Array.from({ length: RATE }, (_, i) => Math.sin((2 * Math.PI * hz * i) / RATE)),
  ];
  const level = (chs) => db(Math.sqrt(2 * power(chs[0].subarray(RATE / 2))));
  assert.ok(level(highpass(sine(25), RATE, 100)) < -45);
  assert.ok(Math.abs(level(highpass(sine(400), RATE, 100))) < 0.1);
});

test('stereo noise is wide, partials and a chorus not mono', () => {
  const corr = ([l, r]) => {
    let [lr, ll, rr] = [0, 0, 0];
    for (let i = 0; i < l.length; i++) [lr, ll, rr] = [lr + l[i] * r[i], ll + l[i] ** 2, rr + r[i] ** 2];
    return lr / Math.sqrt(ll * rr);
  };
  assert.ok(Math.abs(corr(generate({ type: 'noise', channels: 2, seconds: 1, seed: 1 }, RATE))) < 0.05);
  assert.ok(corr(generate({ type: 'partials', f0: 200, count: 8, seconds: 2, seed: 2 }, RATE)) < 0.9);
  assert.ok(corr(generate({ type: 'noise', chorus: {}, seconds: 1, seed: 3 }, RATE)) < 0.9);
});

test('the short register loops in 93 steps: a pitch', () => {
  const [c] = generate({ type: 'lfsr', bits: 15, clock: RATE, seconds: 0.1 }, RATE);
  for (let i = 1000; i < 1100; i++) assert.equal(c[i], c[i + 93]);
  const [long] = generate({ type: 'lfsr', bits: 23, clock: RATE, seconds: 0.1 }, RATE);
  assert.ok(new Set(long).size > 100, 'the long one has many values');
});

test('a kick of the generator keeps its attack', () => {
  const kick = generate({ type: 'kick', start: 400, end: 55, sweepMs: 12, click: 'impulse', drive: 2 }, RATE);
  const s = processSound(kick, RATE, { kind: 'attack', attackMs: 6 });
  assert.ok(s.out[0].length >= Math.round(0.006 * RATE) && s.out[0].length <= Math.round(0.011 * RATE));
});
