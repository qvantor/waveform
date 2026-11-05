import assert from 'node:assert/strict';
import { test } from 'node:test';

import { db, peakOf, processSound, suggestKind } from './dsp.mjs';

const RATE = 44100;
const at = (s) => Math.round(s * RATE);

// A seeded noise (mulberry32), −1..1.
function noise(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

// Mono of `seconds`, each sample f(t, i).
const signal = (seconds, f) => [Float32Array.from({ length: at(seconds) }, (_, i) => f(i / RATE, i))];
const rms = (c, a = 0, b = c.length) => Math.sqrt(c.subarray(a, b).reduce((s, v) => s + v * v, 0) / (b - a));

test('a hit starts at its onset, ends faded to 0 under −60 dB of its tail, its peak at 0 dBFS', () => {
  const r = noise(1);
  // 0.2 s of silence, a burst decaying by 50 ms, silence
  const chs = signal(1.2, (t) => (t < 0.2 ? 0 : 0.3 * r() * Math.exp(-(t - 0.2) / 0.05)));
  const s = processSound(chs, RATE, { kind: 'one-shot' });
  assert.ok(s.start >= at(0.195) && s.start <= at(0.2), `start ${s.start}`);
  assert.ok(s.end >= at(0.2 + 0.3), `end ${s.end}: the tail under −60 dB is ~0.35 s after the onset`);
  assert.ok(s.end < at(0.7));
  assert.equal(peakOf(s.out), 1);
  assert.ok(Math.abs(s.out[0].at(-1)) < 1e-3);
});

test('a sound with a silence keeps its first part, all of it with gapMs null', () => {
  const r = noise(2);
  const burst = (t) => (t < 0.2 || (t >= 0.5 && t < 0.7) ? 0.5 * r() : 0);
  const first = processSound(signal(0.8, burst), RATE, { kind: 'one-shot' });
  assert.equal(first.parts, 2);
  assert.ok(first.out[0].length < at(0.25), `${first.out[0].length / RATE} s`);
  const whole = processSound(signal(0.8, burst), RATE, { kind: 'one-shot', gapMs: null });
  assert.equal(whole.parts, 1);
  assert.ok(whole.out[0].length > at(0.65));
});

test('a kick keeps attackMs from its onset', () => {
  const chs = signal(0.6, (t) =>
    t < 0.1 ? 0 : Math.sin(2 * Math.PI * 60 * (t - 0.1) + 0.3) * Math.exp(-(t - 0.1) / 0.2)
  );
  const s = processSound(chs, RATE, { kind: 'attack', attackMs: 30 });
  assert.ok(s.out[0].length >= at(0.03) && s.out[0].length <= at(0.035), `${s.out[0].length / RATE} s`);
  assert.ok(Math.abs(s.out[0].at(-1)) < 1e-3);
});

test('a loop loses its fades and its DC, cut as it goes', () => {
  const r = noise(3);
  // 1 s fade in, 4 s, 1 s fade out, a DC of 0.02 (the level is measured before the DC is removed)
  const chs = signal(6, (t) => 0.02 + 0.3 * r() * Math.min(1, t, 6 - t));
  const s = processSound(chs, RATE, { kind: 'loop', maxSeconds: 10 });
  const out = s.out[0];
  assert.ok(out.length > at(4.3) && out.length < at(4.9), `${out.length / RATE} s`);
  assert.ok(Math.abs(out.reduce((a, v) => a + v, 0) / out.length) < 1e-6);
  // its first and last 100 ms within 3.5 dB of all of it: the fades are gone
  const all = rms(out);
  assert.ok(db(rms(out, 0, at(0.1)) / all) > -3.5);
  assert.ok(db(rms(out, out.length - at(0.1)) / all) > -3.5);
});

test('a loop over maxSeconds goes from its end into its start as the source went on: a hum keeps its phase', () => {
  const r = noise(4);
  const chs = signal(8, (t) => 0.5 * Math.sin(2 * Math.PI * 50 * t) + 0.01 * r());
  const s = processSound(chs, RATE, { kind: 'loop', maxSeconds: 5 });
  const out = s.out[0];
  assert.ok(out.length <= at(5) && out.length >= at(4.9), `${out.length / RATE} s`);
  let step = 0;
  for (let i = 1; i < out.length; i++) step = Math.max(step, Math.abs(out[i] - out[i - 1]));
  assert.ok(
    Math.abs(out[0] - out.at(-1)) <= step,
    `seam ${Math.abs(out[0] - out.at(-1))}, steps up to ${step}`
  );
  assert.ok(Math.abs(db(rms(out, 0, at(0.1)) / rms(out))) < 1, 'the crossfade keeps the level');
});

test('a loop of noise keeps its level through the crossfade', () => {
  const r = noise(5);
  const s = processSound(
    signal(8, () => 0.3 * r()),
    RATE,
    { kind: 'loop', maxSeconds: 5 }
  );
  assert.ok(Math.abs(s.cap.xfadeDb) < 0.5, `${s.cap.xfadeDb} dB`);
  assert.ok(Math.abs(db(rms(s.out[0], 0, at(0.1)) / rms(s.out[0]))) < 0.5);
});

test('a one-shot over maxSeconds fades out over its last 250 ms', () => {
  const r = noise(6);
  const s = processSound(
    signal(8, (t) => 0.3 * r() * Math.exp(-t / 4)),
    RATE,
    { kind: 'one-shot', maxSeconds: 5 }
  );
  assert.equal(s.out[0].length, at(5));
  assert.equal(s.fadeOut, at(0.25));
  assert.ok(Math.abs(s.out[0].at(-1)) < 1e-3);
});

test('equal channels are mono', () => {
  const r = noise(7);
  const [c] = signal(0.5, (t) => (t < 0.1 ? 0 : 0.4 * r() * Math.exp(-(t - 0.1) / 0.05)));
  const mono = processSound([c, c.slice()], RATE, { kind: 'one-shot' });
  assert.equal(mono.out.length, 1);
  assert.equal(mono.mono, true);
  const other = c.map((v, i) => v * (i % 2 ? 0.5 : 1));
  assert.equal(processSound([c, other], RATE, { kind: 'one-shot' }).out.length, 2);
});

test('the suggested kind: a steady noise loops, a hit and a tone with pauses do not', () => {
  const r = noise(8);
  assert.equal(
    suggestKind(
      signal(4, () => 0.3 * r()),
      RATE
    ),
    'loop'
  );
  assert.equal(
    suggestKind(
      signal(4, (t) => r() * Math.exp(-t / 0.1)),
      RATE
    ),
    'one-shot'
  );
  assert.equal(
    suggestKind(
      signal(8, (t) => (Math.floor(t / 2) % 2 ? 0 : Math.sin(2 * Math.PI * 440 * t))),
      RATE
    ),
    'one-shot'
  );
});
