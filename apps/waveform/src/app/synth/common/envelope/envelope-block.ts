import { EnvelopeParams, envelopeLevel, envelopeStage } from './envelope-curve';

// the render quantum, the values grow if a block is longer
const BLOCK = 128;

// an envelope of a note in an audio worklet, rendered block by block: one value per sample, exact to the
// sample (linear between the corners, a corner falls on its sample). `startFrame` is the frame of the
// context the envelope starts at (the note on, in legato the start of the phrase); release(frame) starts the
// release at that frame from the level reached there. A block within one flat stage (before the start, hold,
// sustain, after the release) is constant: one value, `value` and values[a] (the others are not written)
export const createEnvelopeBlock = (params: EnvelopeParams, sampleRate: number, startFrame: number) => {
  const stage = new Float64Array(3);
  let releasedAt = Infinity;
  // the frame the envelope is 0 from on (Infinity until it is released)
  let endFrame = Infinity;
  // the flat stage of the last block: its value and the frame the next stage starts at (the next blocks within
  // it are not worked out again)
  let flatValue = 0;
  let flatUntil = -Infinity;
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
        envelopeLevel(params, releasedAt) > 0
          ? Math.ceil(startFrame + (releasedAt + params.release) * sampleRate - 1e-6)
          : frame;
    },
    // values[a..b) of the block at `frame`; constant: one flat stage spans them
    render: (frame: number, a: number, b: number) => {
      if (state.values.length < b) state.values = new Float32Array(b);
      const { values } = state;
      if (frame + b <= flatUntil) {
        state.constant = true;
        state.value = flatValue;
        values[a] = flatValue;
        return;
      }
      let i = a;
      state.constant = false;
      while (i < b) {
        envelopeStage(params, (frame + i - startFrame) / sampleRate, releasedAt, stage);
        const value = stage[0];
        const step = stage[1] / sampleRate;
        // the first sample of the next stage: its time has reached the end of this one
        const end =
          stage[2] === Infinity
            ? b
            : Math.min(b, Math.max(i + 1, Math.ceil(startFrame + stage[2] * sampleRate - frame - 1e-6)));
        if (i === a && end === b && step === 0) {
          state.constant = true;
          state.value = value;
          values[a] = value;
          flatValue = value;
          flatUntil = stage[2] === Infinity ? Infinity : Math.ceil(startFrame + stage[2] * sampleRate - 1e-6);
          return;
        }
        for (let s = i; s < end; s++) values[s] = value + step * (s - i);
        i = end;
      }
    },
  };
  return state;
};

export type EnvelopeBlock = ReturnType<typeof createEnvelopeBlock>;
