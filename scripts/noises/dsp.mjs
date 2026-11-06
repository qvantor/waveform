// The processing of a noise sample, as the noises of the reference instrument are made (measured on its
// factory set): peak at 0 dBFS, no silence before the sound; a hit ends faded to 0, a continuous sound
// loops, cut as it goes, no fades. Channels in, channels out (Float32Arrays at `rate`).

export const db = (v) => (v > 0 ? 20 * Math.log10(v) : -200);

// RMS of all channels over windows of `win` samples every `hop`, in dB.
export function envelope(chs, win, hop) {
  const n = chs[0].length;
  const out = [];
  for (let s = 0; s < n; s += hop) {
    const e = Math.min(n, s + win);
    let sum = 0;
    for (const c of chs) for (let i = s; i < e; i++) sum += c[i] * c[i];
    out.push(db(Math.sqrt(sum / ((e - s) * chs.length))));
  }
  return out;
}

const quantile = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length)))];
};

export function peakOf(chs) {
  let p = 0;
  for (const c of chs) for (let i = 0; i < c.length; i++) p = Math.max(p, Math.abs(c[i]));
  return p;
}

// The nearest sign change of the channels' sum to i within ±range.
function zeroCrossing(chs, i, range) {
  const n = chs[0].length;
  const sum = (k) => chs.reduce((s, c) => s + c[k], 0);
  for (let d = 0; d <= range; d++) {
    for (const k of [i - d, i + d]) {
      if (k <= 0 || k >= n) continue;
      const a = sum(k - 1);
      const b = sum(k);
      if (a === 0 || Math.sign(a) !== Math.sign(b)) return k;
    }
  }
  return i;
}

function raisedCosine(chs, a, b, rising) {
  const len = b - a;
  for (let i = 0; i < len; i++) {
    const g = 0.5 - 0.5 * Math.cos((Math.PI * (i + 0.5)) / len);
    for (const c of chs) c[a + i] *= rising ? g : 1 - g;
  }
}

// Runs of windows at or over thr, split by gaps of `gap` windows or more below it. A run that never gets
// 10 dB over thr (a tail flickering around it) belongs to the part before it.
export function partsOf(env, thr, gap) {
  const runs = [];
  let cur = null;
  env.forEach((v, w) => {
    if (v >= thr) {
      if (cur && w - cur.b > gap) cur = null;
      if (!cur) runs.push((cur = { a: w, b: w, max: v }));
      cur.b = w;
      cur.max = Math.max(cur.max, v);
    }
  });
  const parts = [];
  for (const r of runs) {
    const prev = parts.at(-1);
    if (prev && r.max < thr + 10) prev.b = r.b;
    else parts.push(r);
  }
  return parts;
}

// A suggestion for a new sound: continuous when its level stays within 10 dB of its median for 3 s at least
// and it is silent (60 dB under its loudest) for a tenth of it at most (a tone with pauses is no loop).
export function suggestKind(chs, rate) {
  const env = envelope(chs, Math.round(0.02 * rate), Math.round(0.01 * rate));
  const top = Math.max(...env);
  if (env.filter((v) => v < top - 60).length > env.length / 10) return 'one-shot';
  const active = env.filter((v) => v > top - 70);
  const spread = quantile(active, 0.95) - quantile(active, 0.5);
  return chs[0].length / rate >= 3 && spread <= 10 ? 'loop' : 'one-shot';
}

// A hit (or an event: a breath, a rustle, a bell) from its onset (a pre-roll of at most 5 ms back to a zero
// crossing, faded in; the onset itself untouched) to where its tail falls below −60 dB of the peak or to
// 3 dB over the noise floor, faded out; with attackMs only that much of it from the onset. Only its first
// part stays: the sound up to a silence of gapMs (null: none is a silence).
export function trimOneShot(chs, rate, { attackMs = 0, gapMs = 100 } = {}) {
  const n = chs[0].length;
  const peak = peakOf(chs);
  const hop = Math.round(0.005 * rate);
  const env = envelope(chs, Math.round(0.01 * rate), hop);
  // The noise floor: the quietest 50 ms (digital silence aside); a tail decaying to the end of the file
  // has its end there, so only the last 3 dB of such a tail go. A sound loud all along has no floor: its
  // quietest part is still the sound (30 dB under the peak at least).
  const smooth = envelope(chs, Math.round(0.05 * rate), hop).filter((v) => v > -150);
  const quietest = smooth.length ? Math.min(...smooth) : -200;
  const floorDb = quietest <= db(peak) - 30 ? quietest : -200;
  const onsetThr = Math.min(peak * 0.1, Math.max(peak * 10 ** (-48 / 20), 4 * 10 ** (floorDb / 20)));
  const endDb = Math.max(db(peak) - 60, floorDb + 3);
  // The first part within 20 dB of the loudest: a blip of noise before the sound is no part.
  const gap = gapMs == null ? Infinity : Math.round(((gapMs / 1000) * rate) / hop);
  const parts = partsOf(env, endDb, gap);
  const top = Math.max(...env);
  const part = parts.find((p) => p.max >= top - 20) ?? { a: 0, b: env.length - 1 };
  let onset = Math.max(0, (part.a - 1) * hop);
  while (onset < n && !chs.some((c) => Math.abs(c[onset]) >= onsetThr)) onset++;
  if (onset === n) onset = 0;
  let start = onset;
  const back = Math.round(0.005 * rate);
  const sum = (k) => chs.reduce((s, c) => s + c[k], 0);
  while (start > 0 && onset - start < back && Math.sign(sum(start - 1)) === Math.sign(sum(start))) start--;
  const end = attackMs
    ? Math.min(n, onset + Math.round((attackMs / 1000) * rate))
    : Math.min(n, (part.b + 1) * hop + Math.round(0.01 * rate) + Math.round(0.005 * rate));
  const out = chs.map((c) => c.slice(start, end));
  if (start > 0 && onset > start) raisedCosine(out, 0, onset - start, true);
  const len = end - start;
  const fade = attackMs
    ? Math.min(Math.round(0.005 * rate), Math.floor(len / 4))
    : Math.max(Math.min(Math.round(0.05 * rate), Math.floor((end - onset) / 4)), Math.min(len, 32));
  raisedCosine(out, len - fade, len, false);
  return { out, start, end, fadeIn: onset - start, fadeOut: fade, parts: parts.length };
}

// A continuous sound (noise, a texture) without its fades (cut where the level of 200 ms reaches 3 dB under
// its median) at zero crossings, no fades, DC removed. Silence in it is only what is 60 dB under the peak
// (between the crackles of a record is none): up to the first one of gapMs.
export function trimContinuous(chs, rate, { gapMs = 100 } = {}) {
  const n = chs[0].length;
  const hop = Math.round(0.01 * rate);
  const win = Math.round(0.2 * rate);
  const env = envelope(chs, win, hop);
  const top = Math.max(...env);
  const body = quantile(
    env.filter((v) => v > top - 40),
    0.5
  );
  let a = 0;
  while (a < env.length - 1 && env[a] < body - 3) a++;
  let b = env.length - 1;
  while (b > a && env[b] < body - 3) b--;
  // A window's level is the one of its middle.
  const near = Math.round(0.005 * rate);
  let start = a === 0 ? 0 : zeroCrossing(chs, Math.min(n - 1, a * hop + win / 2), near);
  let end = b === env.length - 1 ? n : zeroCrossing(chs, Math.min(n - 1, b * hop + win / 2), near);
  if (end - start < Math.round(0.25 * rate)) {
    start = 0;
    end = n;
  }
  let count = 1;
  if (gapMs != null) {
    const fine = Math.round(0.01 * rate);
    const parts = partsOf(envelope(chs, fine, fine), db(peakOf(chs)) - 60, Math.round(gapMs / 10));
    const first = parts.find((p) => (p.b + 1) * fine > start);
    count = parts.length;
    if (parts.length > 1 && first && (first.b + 1) * fine < end)
      end = zeroCrossing(chs, Math.min(n - 1, (first.b + 1) * fine), near);
  }
  const out = chs.map((c) => {
    const s = c.slice(start, end);
    let mean = 0;
    for (const v of s) mean += v;
    mean /= s.length;
    for (let i = 0; i < s.length; i++) s[i] -= mean;
    return s;
  });
  return { out, start, end, fadeIn: 0, fadeOut: 0, parts: count };
}

// A seamless loop of about `max` samples from the start of a continuous sound: the loop point L within the
// last 100 ms of max where the sound after it is most like its start (a hum keeps its phase), the 100 ms
// after L crossfaded into the start, so that playing from the end into the start goes on as the source did
// from L. Linear gains scaled to keep the power for the correlation ρ of the two parts:
// gin² + gout² + 2ρ·gin·gout = 1 (ρ 0: equal power, ρ 1: linear).
export function loopCut(chs, max, rate) {
  const n = chs[0].length;
  const xf = Math.min(Math.round(0.1 * rate), n - max);
  const w = Math.min(2048, xf);
  const dot = (a, b) => {
    let s = 0;
    for (const c of chs) for (let i = 0; i < w; i++) s += c[a + i] * c[b + i];
    return s;
  };
  const e0 = dot(0, 0);
  let best = max;
  let corr = -Infinity;
  for (let L = max - Math.round(0.1 * rate); L <= max; L++) {
    const r = dot(0, L) / Math.sqrt(e0 * dot(L, L) || 1);
    if (r > corr) {
      corr = r;
      best = L;
    }
  }
  const xfade = Math.min(xf, n - best);
  const pow = (a, len) => chs.reduce((s, c) => s + c.subarray(a, a + len).reduce((t, v) => t + v * v, 0), 0);
  let cross = 0;
  for (const c of chs) for (let i = 0; i < xfade; i++) cross += c[i] * c[best + i];
  const p0 = pow(0, xfade);
  const p1 = pow(best, xfade);
  const rho = Math.min(1, Math.max(0, cross / Math.sqrt(p0 * p1 || 1)));
  const out = chs.map((c) => {
    const o = c.slice(0, best);
    for (let i = 0; i < xfade; i++) {
      const x = (i + 0.5) / xfade;
      const norm = Math.sqrt(x * x + (1 - x) * (1 - x) + 2 * rho * x * (1 - x));
      // in: the start fading in, out: the sound after L fading out
      o[i] = (c[i] * x + c[best + i] * (1 - x)) / norm;
    }
    return o;
  });
  const xfadePower = out.reduce((s, o) => s + o.subarray(0, xfade).reduce((t, v) => t + v * v, 0), 0);
  return { out, xfade, corr, rho, xfadeDb: 10 * Math.log10(xfadePower / ((p0 + p1) / 2)) };
}

// A biquad of the Audio EQ Cookbook: highpass, lowpass, bandpass (0 dB at its centre).
export function biquad(type, hz, q, rate) {
  const w = (2 * Math.PI * hz) / rate;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const b =
    type === 'highpass'
      ? [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2]
      : type === 'lowpass'
        ? [(1 - cos) / 2, 1 - cos, (1 - cos) / 2]
        : [alpha, 0, -alpha];
  const a0 = 1 + alpha;
  return { b0: b[0] / a0, b1: b[1] / a0, b2: b[2] / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}

// A channel through a biquad (transposed direct form II, in doubles).
export function filtered(c, { b0, b1, b2, a1, a2 }) {
  const out = new Float32Array(c.length);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < c.length; i++) {
    const x = c[i];
    const y = b0 * x + s1;
    s1 = b1 * x - a1 * y + s2;
    s2 = b2 * x - a2 * y;
    out[i] = y;
  }
  return out;
}

// A 4th-order Butterworth highpass (24 dB/oct) at hz: the rumble under a recording.
export function highpass(chs, rate, hz) {
  const stages = [0.5412, 1.3066].map((q) => biquad('highpass', hz, q, rate));
  return chs.map((c) => stages.reduce((x, s) => filtered(x, s), c));
}

// Stereo with channels equal within −60 dB of the peak is mono.
export function toMono(chs) {
  if (chs.length !== 2) return chs;
  const peak = peakOf(chs);
  let diff = 0;
  for (let i = 0; i < chs[0].length; i++) diff = Math.max(diff, Math.abs(chs[0][i] - chs[1][i]));
  return diff <= peak * 1e-3 ? [chs[0].map((v, i) => (v + chs[1][i]) / 2)] : chs;
}

// One sound of the manifest: kind 'one-shot', 'attack' (a kick's first attackMs) or 'loop'; at most
// maxSeconds (a loop made seamless, a one-shot faded out over its last 250 ms); peak at 0 dBFS.
export function processSound(channels, rate, { kind, attackMs = 30, gapMs = 100, maxSeconds = 5 }) {
  const chs = toMono(channels);
  const t =
    kind === 'loop'
      ? trimContinuous(chs, rate, { gapMs })
      : trimOneShot(chs, rate, { attackMs: kind === 'attack' ? attackMs : 0, gapMs });
  let out = t.out;
  let cap = null;
  let fadeOut = t.fadeOut;
  const max = Math.round(maxSeconds * rate);
  if (out[0].length > max) {
    const from = out[0].length / rate;
    if (kind === 'loop') {
      const loop = loopCut(out, max, rate);
      out = loop.out;
      cap = {
        from,
        xfadeMs: (loop.xfade / rate) * 1000,
        corr: loop.corr,
        rho: loop.rho,
        xfadeDb: loop.xfadeDb,
      };
    } else {
      out = out.map((c) => c.slice(0, max));
      fadeOut = Math.round(0.25 * rate);
      raisedCosine(out, max - fadeOut, max, false);
      cap = { from };
    }
  }
  const peak = peakOf(out);
  const gain = peak > 0 ? 1 / peak : 1;
  for (const c of out) for (let i = 0; i < c.length; i++) c[i] *= gain;
  return {
    out,
    mono: chs !== channels,
    start: t.start,
    end: t.end,
    fadeIn: t.fadeIn,
    fadeOut,
    parts: t.parts,
    cap,
    gain,
    mixed: chs,
  };
}
