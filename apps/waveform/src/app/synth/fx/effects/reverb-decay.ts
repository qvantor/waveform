// base lengths (s) of the feedback lines, mutually prime-ish so their echoes don't line up
export const LINE_TIMES = [
  0.0271, 0.0297, 0.0319, 0.0343, 0.0371, 0.0397, 0.0411, 0.0437, 0.0473, 0.0509, 0.0531, 0.0569, 0.0593,
  0.0637, 0.0679, 0.0733,
];
// base lengths (s) of the allpass inside every line: a pass smears an echo into many, so even the
// short lines of a small room give a dense tail instead of a metallic ring
export const LOOP_ALLPASS_TIMES = [
  0.0053, 0.0079, 0.0061, 0.0089, 0.0047, 0.0071, 0.0097, 0.0059, 0.0083, 0.0067, 0.0101, 0.0049, 0.0073,
  0.0091, 0.0057, 0.0087,
];

// the highs above Hi damp ring this part of the decay time
export const HF_RATIO = 0.25;
// the lowshelf frequency: Bass sets the decay below it
export const XOVER = 300;
// the deepest highshelf cut per pass, short decays damp the highs less than HF_RATIO
const MAX_SHELF_CUT = -40;

// room size 0..1 scales the reflections and the feedback lines 0.3..1.5 times
export const sizeFactor = (size: number) => 0.3 + size * 1.2;

// a pass through line i (s): the delay and its allpass, both scale with the room
export const loopLength = (i: number, factor: number) => (LINE_TIMES[i] + LOOP_ALLPASS_TIMES[i]) * factor;

const TOTAL_LOOP = LINE_TIMES.reduce((sum, _, i) => sum + loopLength(i, 1), 0);
// the modes of the tail are 1 / (all loops) Hz apart and 2.2 / decay Hz wide; overlapping less, they ring
// as separate metallic tones (a tiny room with a long decay and no modulation)
export const MIN_MODAL_OVERLAP = 0.19;

// the scale of the feedback lines: the room size, but never shorter than the decay needs for overlapping
// modes, so a long decay grows the lines of a small room (its early reflections stay small)
export const lineFactor = (size: number, decay: number) =>
  Math.max(sizeFactor(size), (MIN_MODAL_OVERLAP * decay) / (2.2 * TOTAL_LOOP));

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
