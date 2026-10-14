// base lengths (s) of the feedback lines, mutually prime-ish so their echoes don't line up
export const LINE_TIMES = [0.0297, 0.0371, 0.0411, 0.0437, 0.0531, 0.0593, 0.0679, 0.0733];

// the highs above Hi damp ring this part of the decay time
export const HF_RATIO = 0.25;
// the lowshelf frequency: Bass sets the decay below it
export const XOVER = 300;
// the deepest highshelf cut per pass, short decays damp the highs less than HF_RATIO
const MAX_SHELF_CUT = -40;

// room size 0..1 scales the reflections and the feedback lines 0.3..1.5 times
export const sizeFactor = (size: number) => 0.3 + size * 1.2;

// per pass of a feedback line `length` seconds long: the gain for the RT60 of `decay` at the mids,
// a lowshelf (dB) so the lows ring decay × bass and a highshelf (dB) so the highs ring decay × HF_RATIO
export const lineDecay = (length: number, decay: number, bass: number) => {
  const db = (60 * length) / decay;
  return {
    gain: 10 ** (-db / 20),
    lowDb: db * (1 - 1 / bass),
    highDb: Math.max(MAX_SHELF_CUT, -db * (1 / HF_RATIO - 1)),
  };
};
