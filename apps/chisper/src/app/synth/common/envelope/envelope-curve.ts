// the envelopes ENV 1–3 as functions of time, shared by the voice worklet, the fx worklets, the main thread
// and the specs: no imports. Times in seconds from the start of the envelope (the note on, in legato the
// start of the phrase). The stages: attack 0 → 1, hold at 1, decay 1 → sustain, sustain until the release;
// the release goes from the level it starts at to 0 in `release` seconds, whatever that level. An envelope
// started again on a voice that sounds (mono) starts its attack from the level it has reached, `from`: to 1 in
// the same `attack` (its stages end where those of a new note do), no step. The attack, the decay and the
// release are linear, or curved by `curves` (k of curveShape; the Rust voice plays them, the TS one, the
// rollback, plays every stage linear)

// the curvature of the attack, the decay and the release: k of curveShape, 0 linear (the env model holds them,
// by default ENVELOPE_CURVES of the preset schema; a type, not an interface: the snapshot
// of the env model takes index signatures)
export type EnvelopeCurves = {
  attack: number;
  decay: number;
  release: number;
};

export interface EnvelopeParams {
  attack: number;
  hold: number;
  decay: number;
  sustain: number;
  release: number;
  curves?: EnvelopeCurves;
}

// the share of a stage done at the share x of its time: (1 - e^(-k·x)) / (1 - e^(-k)), x at k 0; k > 0 moves fast
// at first, then slowly (a decay or a release falls fast, then settles), k < 0 the other way round
export const curveShape = (k: number, x: number) =>
  k === 0 ? x : (1 - Math.exp(-k * x)) / (1 - Math.exp(-k));

// from → to over `length` seconds, `done` of them done (the linear one as it was: its bits)
const stage = (from: number, to: number, k: number, done: number, length: number) =>
  k === 0 ? from + ((to - from) * done) / length : from + (to - from) * curveShape(k, done / length);
// a release from `level`, r of its seconds done
const releaseLevel = (level: number, k: number, r: number, release: number) =>
  k === 0 ? level * (1 - r / release) : level * (1 - curveShape(k, r / release));

// the level `t` seconds after the start while the key is held, the attack from `from`
export const envelopeLevel = (
  { attack, hold, decay, sustain, curves }: EnvelopeParams,
  t: number,
  from = 0
) => {
  if (t < 0) return from;
  if (t < attack) return stage(from, 1, curves?.attack ?? 0, t, attack);
  if (t < attack + hold) return 1;
  if (t < attack + hold + decay) return stage(1, sustain, curves?.decay ?? 0, t - attack - hold, decay);
  return sustain;
};

// the level `t` seconds after the start, released `releasedAt` seconds after it (Infinity: held), the attack
// from `from`
export const envelopeValue = (env: EnvelopeParams, t: number, releasedAt = Infinity, from = 0) => {
  if (t < releasedAt) return envelopeLevel(env, t, from);
  const level = envelopeLevel(env, releasedAt, from);
  const r = t - releasedAt;
  return r < env.release ? releaseLevel(level, env.curves?.release ?? 0, r, env.release) : 0;
};

// the stage at `t` as a line (the TS voice: its stages are linear, `curves` are not read): out[0] its value at
// t, out[1] its slope (per second), out[2] the time it lasts until (Infinity: for ever). Flat stages (before the
// start, hold, sustain, after the release) have the slope 0: a block within one of them has one value. Released
// at `releasedAt`, the attack from `from`; returns out
export const envelopeStage = (
  env: EnvelopeParams,
  t: number,
  releasedAt: number,
  out: Float64Array,
  from = 0
) => {
  const { attack, hold, decay, sustain, release } = env;
  if (t >= releasedAt) {
    const level = envelopeLevel(env, releasedAt, from);
    const r = t - releasedAt;
    if (r < release && level > 0) {
      out[1] = -level / release;
      out[0] = level + out[1] * r;
      out[2] = releasedAt + release;
    } else {
      out[0] = 0;
      out[1] = 0;
      out[2] = Infinity;
    }
    return out;
  }
  const decayEnd = attack + hold + decay;
  if (t < 0) {
    out[0] = from;
    out[1] = 0;
    out[2] = 0;
  } else if (t < attack) {
    out[1] = (1 - from) / attack;
    out[0] = from + out[1] * t;
    out[2] = attack;
  } else if (t < attack + hold) {
    out[0] = 1;
    out[1] = 0;
    out[2] = attack + hold;
  } else if (t < decayEnd) {
    out[1] = (sustain - 1) / decay;
    out[0] = 1 + out[1] * (t - attack - hold);
    out[2] = decayEnd;
  } else {
    out[0] = sustain;
    out[1] = 0;
    out[2] = Infinity;
  }
  if (releasedAt < out[2]) out[2] = releasedAt;
  return out;
};
