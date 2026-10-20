import { EnvelopeParams, envelopeLevel, envelopeStage, envelopeValue } from './envelope-curve';

// the render quantum, the values grow if a block is longer
const BLOCK = 128;

// the envelope a block renders before a frame it was started again at
interface Before {
  until: number;
  startFrame: number;
  releasedAt: number;
  from: number;
}

// an envelope of a note in an audio worklet, rendered block by block: one value per sample, exact to the
// sample (linear between the corners, a corner falls on its sample). `startFrame` is the frame of the
// context the envelope starts at (the note on, in legato the start of the phrase); release(frame) starts the
// release at that frame from the level reached there, retrigger(frame) starts it again there from that level
// (mono). A block within one flat stage (before the start, hold, sustain, after the release) is constant: one
// value, `value` and values[a] (the others are not written). Its stages are linear: the curves of the envelope
// are the Rust voice's (this voice is the rollback, it plays as it did)
export const createEnvelopeBlock = (curved: EnvelopeParams, sampleRate: number, startFrame: number) => {
  const params: EnvelopeParams = curved.curves ? { ...curved, curves: undefined } : curved;
  const stage = new Float64Array(3);
  let releasedAt = Infinity;
  // the level the attack starts from: 0, the level reached where it was started again
  let from = 0;
  // the frame the envelope is 0 from on (Infinity until it is released)
  let endFrame = Infinity;
  // the flat stage of the last block: its value and the frame the next stage starts at (the next blocks within
  // it are not worked out again)
  let flatValue = 0;
  let flatUntil = -Infinity;
  // the envelopes before the frames it was started again at within the block to render (one, but for a gate
  // that changes within a few samples)
  const before: Before[] = [];

  // values[i..b) of the block at `frame` of the envelope started at `start` (released at `released`, the attack
  // from `level`; by default the one it has now); whole: i..b is the block (a..b), it may be one flat stage
  const fill = (
    frame: number,
    i: number,
    b: number,
    whole: boolean,
    start = startFrame,
    released = releasedAt,
    level = from
  ) => {
    const { values } = state;
    const a = i;
    while (i < b) {
      envelopeStage(params, (frame + i - start) / sampleRate, released, stage, level);
      const value = stage[0];
      const step = stage[1] / sampleRate;
      // the first sample of the next stage: its time has reached the end of this one
      const end =
        stage[2] === Infinity
          ? b
          : Math.min(b, Math.max(i + 1, Math.ceil(start + stage[2] * sampleRate - frame - 1e-6)));
      if (whole && i === a && end === b && step === 0) {
        state.constant = true;
        state.value = value;
        values[a] = value;
        flatValue = value;
        flatUntil = stage[2] === Infinity ? Infinity : Math.ceil(start + stage[2] * sampleRate - 1e-6);
        return;
      }
      for (let s = i; s < end; s++) values[s] = value + step * (s - i);
      i = end;
    }
  };

  const state = {
    values: new Float32Array(BLOCK),
    constant: false,
    // the value of a constant block, also while the blocks after it within its stage are not rendered (their
    // a may differ: values[a] is of the block rendered)
    value: 0,
    get endFrame() {
      return endFrame;
    },
    get released() {
      return releasedAt !== Infinity;
    },
    // the frame the flat stage of the last block lasts until (-Infinity: it moved)
    get flatUntil() {
      return state.constant ? flatUntil : -Infinity;
    },
    // the envelope starts at `frame` instead (before it is rendered or released: a voice processed after its
    // start)
    startAt: (frame: number) => {
      startFrame = frame;
      flatUntil = -Infinity;
    },
    // the release starts at `frame` (the first one counts)
    release: (frame: number) => {
      if (releasedAt !== Infinity) return;
      releasedAt = (frame - startFrame) / sampleRate;
      flatUntil = -Infinity;
      // released at 0 (before its start, after a decay to a sustain of 0): it ends there
      endFrame =
        envelopeLevel(params, releasedAt, from) > 0
          ? Math.ceil(startFrame + (releasedAt + params.release) * sampleRate - 1e-6)
          : frame;
    },
    // the envelope starts again at `frame`, a frame of the block at `block` (it is rendered next), held, its
    // attack from the level it has there (released or not): the samples of the block before it keep the
    // envelope they had. Those of an earlier block (it wasn't rendered: no route read it) are dropped
    retrigger: (frame: number, block: number) => {
      while (before.length > 0 && before[0].until < block) before.shift();
      const level = envelopeValue(params, (frame - startFrame) / sampleRate, releasedAt, from);
      before.push({ until: frame, startFrame, releasedAt, from });
      startFrame = frame;
      from = level;
      releasedAt = Infinity;
      endFrame = Infinity;
      flatUntil = -Infinity;
    },
    // values[a..b) of the block at `frame`; constant: one flat stage spans them
    render: (frame: number, a: number, b: number) => {
      if (state.values.length < b) state.values = new Float32Array(b);
      const { values } = state;
      if (before.length > 0) {
        // up to each frame it was started again at, the envelope it had before, then the one it has now
        let i = a;
        for (const previous of before) {
          const end = Math.min(b, Math.max(i, previous.until - frame));
          fill(frame, i, end, false, previous.startFrame, previous.releasedAt, previous.from);
          i = end;
        }
        fill(frame, i, b, false);
        before.length = 0;
        state.constant = false;
        return;
      }
      if (frame + b <= flatUntil) {
        state.constant = true;
        state.value = flatValue;
        values[a] = flatValue;
        return;
      }
      state.constant = false;
      fill(frame, a, b, true);
    },
  };
  return state;
};

export type EnvelopeBlock = ReturnType<typeof createEnvelopeBlock>;
