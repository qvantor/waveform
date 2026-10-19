// the envelopes ENV 1–3 as functions of time, shared by the voice worklet, the fx worklets, the main thread
// and the specs: no imports. Times in seconds from the start of the envelope (the note on, in legato the
// start of the phrase). The stages are linear: attack 0 → 1, hold at 1, decay 1 → sustain, sustain until
// the release; the release goes from the level it starts at to 0 in `release` seconds, whatever that level

export interface EnvelopeParams {
  attack: number;
  hold: number;
  decay: number;
  sustain: number;
  release: number;
}

// the level `t` seconds after the start while the key is held
export const envelopeLevel = ({ attack, hold, decay, sustain }: EnvelopeParams, t: number) => {
  if (t < 0) return 0;
  if (t < attack) return t / attack;
  if (t < attack + hold) return 1;
  if (t < attack + hold + decay) return 1 + ((sustain - 1) * (t - attack - hold)) / decay;
  return sustain;
};

// the level `t` seconds after the start, released `releasedAt` seconds after it (Infinity: held)
export const envelopeValue = (env: EnvelopeParams, t: number, releasedAt = Infinity) => {
  if (t < releasedAt) return envelopeLevel(env, t);
  const from = envelopeLevel(env, releasedAt);
  const r = t - releasedAt;
  return r < env.release ? from * (1 - r / env.release) : 0;
};

// envelopeValue just before t: at a corner the end of the stage before it. They differ where the envelope
// steps: an attack, a decay or a release of 0 (the automation of a knob holds a stage, then steps with it)
export const envelopeValueBefore = (env: EnvelopeParams, t: number, releasedAt = Infinity) => {
  const { attack, hold, decay, sustain, release } = env;
  if (t <= releasedAt) {
    if (t <= 0) return 0;
    if (t <= attack) return t / attack;
    if (t <= attack + hold) return 1;
    if (t <= attack + hold + decay) return 1 + ((sustain - 1) * (t - attack - hold)) / decay;
    return sustain;
  }
  const r = t - releasedAt;
  return r <= release ? envelopeLevel(env, releasedAt) * (1 - r / release) : 0;
};

// the stage at `t`: out[0] its value at t, out[1] its slope (per second), out[2] the time it lasts until
// (Infinity: for ever). Flat stages (before the start, hold, sustain, after the release) have the slope 0:
// a block within one of them has one value. Released at `releasedAt`; returns out
export const envelopeStage = (env: EnvelopeParams, t: number, releasedAt: number, out: Float64Array) => {
  const { attack, hold, decay, sustain, release } = env;
  if (t >= releasedAt) {
    const from = envelopeLevel(env, releasedAt);
    const r = t - releasedAt;
    if (r < release && from > 0) {
      out[1] = -from / release;
      out[0] = from + out[1] * r;
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
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
  } else if (t < attack) {
    out[0] = t / attack;
    out[1] = 1 / attack;
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
