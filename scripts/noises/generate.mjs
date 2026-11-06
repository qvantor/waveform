// Noise samples made, not recorded: the `generate` of a sound of the manifest (its type and params), the same
// bytes from the same params (a seeded random). Channels out, at `rate`, for process.mjs to trim and loop.
import { biquad, filtered } from './dsp.mjs';

// mulberry32: 0..1
export function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Gaussian white noise (Box–Muller).
function gauss(r) {
  return () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
}

// Noise of a color: white (flat), pink (−3 dB/oct, Paul Kellet's filter of 44.1 kHz), brown (−6 dB/oct from
// 20 Hz), blue (+3: pink differentiated), violet (+6: white differentiated).
function colored(color, n, seed, rate) {
  const w = gauss(random(seed));
  const out = new Float32Array(n);
  if (color === 'white') for (let i = 0; i < n; i++) out[i] = w();
  else if (color === 'violet') {
    let prev = w();
    for (let i = 0; i < n; i++) {
      const x = w();
      out[i] = x - prev;
      prev = x;
    }
  } else if (color === 'brown') {
    const p = Math.exp((-2 * Math.PI * 20) / rate);
    let b = 0;
    for (let i = 0; i < n; i++) out[i] = b = p * b + (1 - p) * w();
  } else if (color === 'pink' || color === 'blue') {
    let [b0, b1, b2, b3, b4, b5, b6, prev] = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      const x = w();
      b0 = 0.99886 * b0 + x * 0.0555179;
      b1 = 0.99332 * b1 + x * 0.0750759;
      b2 = 0.969 * b2 + x * 0.153852;
      b3 = 0.8665 * b3 + x * 0.3104856;
      b4 = 0.55 * b4 + x * 0.5329522;
      b5 = -0.7616 * b5 - x * 0.016898;
      const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362;
      b6 = x * 0.115926;
      out[i] = color === 'pink' ? pink : pink - prev;
      prev = pink;
    }
  } else throw new Error(`color ${color}`);
  return out;
}

// A stereo chorus of a mono sound: each side the sound and itself delayed by base ± depth ms, the delay moved
// by a sine of `hz`, the sides a quarter of its cycle apart.
function chorus(c, rate, { base = 3.5, depth = 1.5, hz = 0.5 } = {}) {
  return [0, Math.PI / 2].map((offset) => {
    const out = new Float32Array(c.length);
    for (let i = 0; i < c.length; i++) {
      const d = ((base + depth * Math.sin((2 * Math.PI * hz * i) / rate + offset)) / 1000) * rate;
      const j = i - d;
      const k = Math.floor(j);
      const f = j - k;
      const delayed = k < 0 ? 0 : c[k] * (1 - f) + (c[k + 1] ?? 0) * f;
      out[i] = c[i] + delayed;
    }
    return out;
  });
}

const sines = (n, rate, parts) => {
  const out = new Float32Array(n);
  for (const { hz, amp, phase } of parts) {
    if (hz >= 0.45 * rate) continue;
    const w = (2 * Math.PI * hz) / rate;
    for (let i = 0; i < n; i++) out[i] += amp * Math.sin(w * i + phase);
  }
  return out;
};

export const GENERATORS = {
  // { color, channels (2: independent sides, or a chorus), filter: { type, hz, q }, chorus: {} }
  noise({ color = 'white', seconds, seed = 1, channels = 1, filter, chorus: ch }, rate) {
    const n = Math.round(seconds * rate);
    let chs = Array.from({ length: ch ? 1 : channels }, (_, c) => colored(color, n, seed + c * 7919, rate));
    if (filter)
      chs = chs.map((c) => filtered(c, biquad(filter.type, filter.hz, filter.q ?? Math.SQRT1_2, rate)));
    return ch ? chorus(chs[0], rate, ch) : chs;
  },

  // The noise of a linear-feedback shift register clocked at `clock` Hz, held between its steps:
  // 23 bits (taps 22 and 17, 8 of its bits a sample: a long noise) or 15 bits (taps 0 and 6, its last bit:
  // a short loop of 93 steps, metallic).
  lfsr({ bits = 23, clock, seconds }, rate) {
    const n = Math.round(seconds * rate);
    const out = new Float32Array(n);
    let reg = bits === 23 ? 0x7ffff8 : 1;
    let phase = 0;
    let value = 0;
    const read = () =>
      bits === 23
        ? ((((reg >> 22) & 1) << 7) |
            (((reg >> 20) & 1) << 6) |
            (((reg >> 16) & 1) << 5) |
            (((reg >> 13) & 1) << 4) |
            (((reg >> 11) & 1) << 3) |
            (((reg >> 7) & 1) << 2) |
            (((reg >> 4) & 1) << 1) |
            ((reg >> 2) & 1)) /
            127.5 -
          1
        : reg & 1
          ? 1
          : -1;
    for (let i = 0; i < n; i++) {
      phase += clock / rate;
      while (phase >= 1) {
        phase -= 1;
        if (bits === 23) reg = ((reg << 1) | (((reg >> 22) ^ (reg >> 17)) & 1)) & 0x7fffff;
        else reg = (reg >> 1) | (((reg ^ (reg >> 6)) & 1) << 14);
        value = read();
      }
      out[i] = value;
    }
    return [out];
  },

  // White noise held at `hold` Hz and rounded to `bits`.
  crushed({ hold, bits, seconds, seed = 1 }, rate) {
    const n = Math.round(seconds * rate);
    const w = gauss(random(seed));
    const levels = 2 ** (bits - 1);
    const out = new Float32Array(n);
    let phase = 1;
    let value = 0;
    for (let i = 0; i < n; i++) {
      phase += hold / rate;
      if (phase >= 1) {
        phase -= Math.floor(phase);
        value = Math.round(Math.max(-1, Math.min(1, 0.35 * w())) * levels) / levels;
      }
      out[i] = value;
    }
    return [out];
  },

  // Sines at f0 × ratios (or `count` partials stretched by `stretch`: n·√(1 + stretch·n²), or `random`
  // { count, low, high } spread log-uniformly), amps or 1/n^tilt; each side its own phases and a detune of
  // up to ±detune cents a partial: wide, as a pair of strings.
  partials(
    { f0, ratios, amps, count, stretch = 0, random: spread, tilt = 1, detune = 3, seconds, seed = 1 },
    rate
  ) {
    const r = random(seed);
    let rs = ratios;
    if (!rs && spread)
      rs = Array.from({ length: spread.count }, () => (spread.low * (spread.high / spread.low) ** r()) / f0);
    if (!rs) rs = Array.from({ length: count }, (_, k) => (k + 1) * Math.sqrt(1 + stretch * (k + 1) ** 2));
    const n = Math.round(seconds * rate);
    return [0, 1].map(() =>
      sines(
        n,
        rate,
        rs.map((ratio, k) => ({
          hz: f0 * ratio * 2 ** (((r() - 0.5) * 2 * detune) / 1200),
          amp: amps?.[k] ?? 1 / (k + 1) ** tilt,
          phase: 2 * Math.PI * r(),
        }))
      )
    );
  },

  // FM: a carrier at `carrier` Hz, its modulator at carrier × ratio (an irrational ratio: inharmonic), the
  // sides ±detune cents apart.
  fm({ carrier, ratio, index, detune = 2, seconds, seed = 1 }, rate) {
    const r = random(seed);
    const n = Math.round(seconds * rate);
    return [-1, 1].map((side) => {
      const fc = carrier * 2 ** ((side * detune) / 2 / 1200);
      const [pc, pm] = [2 * Math.PI * r(), 2 * Math.PI * r()];
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / rate;
        out[i] = Math.sin(2 * Math.PI * fc * t + index * Math.sin(2 * Math.PI * fc * ratio * t + pm) + pc);
      }
      return out;
    });
  },

  // A ring modulation: `harmonics` of f1 times a sine of f2.
  ring({ f1, harmonics, f2, seconds, seed = 1 }, rate) {
    const r = random(seed);
    const n = Math.round(seconds * rate);
    return [0, 1].map(() => {
      const a = sines(
        n,
        rate,
        Array.from({ length: harmonics }, (_, h) => ({
          hz: f1 * (h + 1),
          amp: 1 / (h + 1),
          phase: 2 * Math.PI * r(),
        }))
      );
      const b = sines(n, rate, [{ hz: f2, amp: 1, phase: 2 * Math.PI * r() }]);
      return a.map((v, i) => v * b[i]);
    });
  },

  // A kick: a sine falling from `start` to `end` Hz by sweepMs, its level up in attackMs and down by decayMs,
  // a click on it (impulse, noise around clickHz, metal: four inharmonic sines) of clickMs, × clickLevel, through
  // tanh(drive·x). process.mjs keeps its attack (kind attack).
  kick(
    {
      start,
      end,
      sweepMs,
      decayMs = 150,
      attackMs = 0.2,
      click = 'none',
      clickHz = 3000,
      clickMs = 2,
      clickLevel = 1,
      drive = 1,
      seconds = 0.3,
      seed = 1,
    },
    rate
  ) {
    const n = Math.round(seconds * rate);
    const w = gauss(random(seed));
    const out = new Float32Array(n);
    const noise =
      click === 'noise'
        ? filtered(
            Float32Array.from({ length: n }, () => w()),
            biquad('bandpass', clickHz, 1, rate)
          )
        : null;
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      const hz = end + (start - end) * Math.exp(-t / (sweepMs / 1000));
      const level = (1 - Math.exp(-t / (attackMs / 1000))) * Math.exp(-t / (decayMs / 1000));
      let y = Math.sin(phase) * level;
      phase += (2 * Math.PI * hz) / rate;
      const c = clickLevel * Math.exp(-t / (clickMs / 1000));
      if (click === 'impulse' && t < 0.0004)
        y += 0.8 * clickLevel * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 0.0004));
      if (click === 'noise') y += 0.5 * noise[i] * c;
      if (click === 'metal')
        for (const f of [3150, 4730, 6290, 8870]) y += 0.15 * Math.sin(2 * Math.PI * f * t) * c;
      out[i] = drive > 1 ? Math.tanh(drive * y) / Math.tanh(drive) : y;
    }
    return [out];
  },
};

export function generate(spec, rate) {
  const g = GENERATORS[spec.type];
  if (!g) throw new Error(`no generator ${spec.type}`);
  return g(spec, rate);
}
