import { BUTTERWORTH_Q, createBiquad, createDcBlocker, createSmoothed, peak, stepAll } from './dsp';
import { makeupGain } from './distortion-makeup';
import { DISTORTION_MODES, modeIndex } from './distortion-modes';
import { createOversampler, OVERSAMPLER_LATENCY, OVERSAMPLING } from './oversampler';

// the distortion runs in an audio worklet (distortion.worklet.ts), this is its signal processing

export const DISTORTION_PROCESSOR = 'waveform-distortion';

// the distortion params (FX_PARAMS.distortion): mode index, drive (dB), tone (Hz), level (dB, on top of the
// makeup gain)
export interface DistortionDspParams {
  mode: number;
  drive: number;
  tone: number;
  level: number;
}

export interface DistortionOptions {
  params: DistortionDspParams;
}

// main thread → worklet: changed params
export interface DistortionMessage {
  params?: Partial<DistortionDspParams>;
}

// samples the output lags the input: the oversampling filters are linear phase, the fx slot delays the dry
// signal as much, so the mix doesn't comb filter
export const DISTORTION_LATENCY = OVERSAMPLER_LATENCY;

// the top of the tone range (FX_PARAMS.distortion.tone.max, not imported: it would bundle zod) is open: the
// lowpass is faded out, so the wet signal keeps the phase of the dry one (a 20 kHz lowpass still delays the
// highs by half a sample, the mix would dull them)
export const TONE_OPEN = 20000;

// the params glide like setSmooth, a new mode crossfades the curves just as fast
const GLIDE = 0.01;
// Hz of the dc blocker, the last stage
export const DC_CUTOFF = 5;
// below this level (-200 dB) the distortion is silent: the state is cleared and the blocks are skipped
const SILENCE = 1e-10;

const dbToGain = (db: number) => 10 ** (db / 20);

// the render quantum, the buffers grow if a block is longer
const BLOCK = 128;

// input × drive → 4× oversampler (up) → curve of the mode × its makeup gain (distortion-makeup.ts) →
// oversampler (down) → tone (lowpass, faded out while open) × level → dc blocker, each channel on its own.
// The curves are odd: a symmetric wave gets no DC and no even harmonics, but an asymmetric one does (a
// narrow pulse with no DC of its own: its wide side is clipped, its narrow one hardly), and that DC would
// follow the notes (thumps on note on and off) and eat into the headroom of the master limiter. A new mode
// fades from the old curve into it, both run meanwhile, each with its own makeup. There are no loops: once
// the input has been silent for longer than the oversampler rings (FIR) only the tails of the dc blocker and
// the tone are rendered, once they have died out the state is cleared and the blocks are skipped (the fx
// slot keeps a removed effect rendered, its closed send makes it silent), so an unused distortion costs
// nothing.
// Each stage runs over the whole block in typed arrays, after the gains of every sample are worked out: a
// chain of calls per sample would box the numbers they return, garbage for the audio thread to collect
export const createDistortionDsp = (sampleRate: number, { params }: DistortionOptions) => {
  const drive = createSmoothed(params.drive, GLIDE, sampleRate);
  const tone = createSmoothed(params.tone, GLIDE, sampleRate);
  const level = createSmoothed(params.level, GLIDE, sampleRate);
  // 1: the tone lowpass is bypassed
  const open = createSmoothed(params.tone >= TONE_OPEN ? 1 : 0, GLIDE, sampleRate);
  // from the previous curve (0) into the current one (1)
  const morph = createSmoothed(1, GLIDE, sampleRate);
  // stepped every block (the tone recomputes its filters while it glides)
  const glides = [drive, level, open, morph];
  const values = [drive, tone, level, open, morph];
  let modeFrom = modeIndex(params.mode);
  let modeTo = modeFrom;
  let morphing = false;

  const channels = [0, 1].map(() => ({
    oversampler: createOversampler(),
    dcBlocker: createDcBlocker(DC_CUTOFF, sampleRate),
    tone: createBiquad(),
  }));
  const [left, right] = channels;

  // per sample of a block: the drive, the level and the open share of the tone; the input × drive, back at
  // the input rate and through the tone lowpass (then the output before it is written)
  let drives = new Float64Array(BLOCK);
  let levels = new Float64Array(BLOCK);
  let opens = new Float64Array(BLOCK);
  let driven = new Float64Array(BLOCK);
  let decimated = new Float64Array(BLOCK);
  let filtered = new Float64Array(BLOCK);
  // per point (OVERSAMPLING per sample): the gains of the current and the previous curve (their makeup gains ×
  // their shares in a fade), the oversampled input and the curve
  let gainsTo = new Float64Array(OVERSAMPLING * BLOCK);
  let gainsFrom = new Float64Array(OVERSAMPLING * BLOCK);
  let points = new Float64Array(OVERSAMPLING * BLOCK);
  let shaped = new Float64Array(OVERSAMPLING * BLOCK);
  const grow = (frames: number) => {
    if (frames <= drives.length) return;
    [drives, levels, opens, driven, decimated, filtered] = [0, 1, 2, 3, 4, 5].map(
      () => new Float64Array(frames)
    );
    [gainsTo, gainsFrom, points, shaped] = [0, 1, 2, 3].map(() => new Float64Array(OVERSAMPLING * frames));
  };

  // silent and cleared: blocks are skipped until the input comes back (a new one waits for its first sound)
  let idle = true;
  // input frames since the last sound
  let quietFrames = 0;
  // the input has been silent for longer than the oversampler rings: its output is 0, it is skipped
  let rungOut = false;

  const updateTone = () =>
    channels.forEach((channel) =>
      channel.tone.set('lowpass', { frequency: tone.value, Q: BUTTERWORTH_Q, gain: 0 }, sampleRate)
    );
  updateTone();

  // a block of a channel into its output, with the gains of the block; returns its peak. The curve gains go
  // on the points, so the decimator never mixes points with and without them when a fade starts or ends.
  // The tone lowpass runs also while open, so it has the current state when it fades in
  const render = (
    { oversampler, dcBlocker, tone: lowpass }: typeof left,
    input: Float32Array,
    output: Float32Array,
    frames: number
  ) => {
    if (rungOut) decimated.fill(0, 0, frames);
    else {
      for (let s = 0; s < frames; s++) driven[s] = input[s] * drives[s];
      oversampler.up(driven, frames, points);
      const length = OVERSAMPLING * frames;
      if (morphing) {
        DISTORTION_MODES[modeFrom].shapeBlock(points, gainsFrom, length, shaped, false);
        DISTORTION_MODES[modeTo].shapeBlock(points, gainsTo, length, shaped, true);
      } else DISTORTION_MODES[modeTo].shapeBlock(points, gainsTo, length, shaped, false);
      oversampler.down(shaped, frames, decimated);
    }
    lowpass.processBlock(decimated, filtered, frames);
    for (let s = 0; s < frames; s++) {
      const x = decimated[s];
      const y = filtered[s];
      const o = opens[s];
      filtered[s] = levels[s] * (o === 1 ? x : y + (x - y) * o);
    }
    dcBlocker.processBlock(filtered, frames);
    let loudest = 0;
    for (let s = 0; s < frames; s++) {
      const value = filtered[s];
      output[s] = value;
      loudest = Math.max(loudest, Math.abs(value));
    }
    return loudest;
  };

  const clear = () =>
    channels.forEach((channel) => {
      channel.oversampler.clear();
      channel.dcBlocker.clear();
      channel.tone.clear();
    });

  const set = (changes: Partial<DistortionDspParams>) => {
    if (changes.drive !== undefined) drive.set(changes.drive, idle);
    if (changes.tone !== undefined) {
      tone.set(changes.tone, idle);
      open.set(changes.tone >= TONE_OPEN ? 1 : 0, idle);
    }
    if (changes.level !== undefined) level.set(changes.level, idle);
    if (changes.mode !== undefined) {
      const mode = modeIndex(changes.mode);
      if (mode === modeTo) return;
      if (mode === modeFrom && morph.value !== 1) {
        // back to the curve of a fade: it turns around where it is, the mix of the curves doesn't jump
        [modeFrom, modeTo] = [modeTo, modeFrom];
        morph.set(1 - morph.value, true);
      } else {
        // from the curve faded into (a third mode during a fade, once there are more than 2, jumps there)
        [modeFrom, modeTo] = [modeTo, mode];
        morph.set(0, true);
      }
      morph.set(1, idle);
    }
  };

  const process = (inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array) => {
    const frames = outL.length;
    quietFrames = Math.max(peak(inL), peak(inR)) < SILENCE ? quietFrames + frames : 0;
    // silent before this block for longer than the oversampler rings
    rungOut = quietFrames - frames > 2 * DISTORTION_LATENCY;
    if (idle) {
      if (quietFrames) {
        outL.fill(0);
        outR.fill(0);
        return;
      }
      idle = false;
      values.forEach((value) => value.snap());
      updateTone();
    }

    if (tone.step(frames)) updateTone();
    stepAll(glides, frames);
    morphing = morph.from !== 1 || morph.value !== 1;
    grow(frames);
    const driveFrom = dbToGain(drive.from);
    const driveStep = (dbToGain(drive.value) - driveFrom) / frames;
    const levelFrom = dbToGain(level.from);
    const levelStep = (dbToGain(level.value) - levelFrom) / frames;
    const openStep = (open.value - open.from) / frames;
    const morphStep = (morph.value - morph.from) / frames;
    // the makeup gains follow the drive
    const makeupFrom = makeupGain(modeTo, drive.from);
    const makeupStep = (makeupGain(modeTo, drive.value) - makeupFrom) / frames;
    const fadingFrom = morphing ? makeupGain(modeFrom, drive.from) : 0;
    const fadingStep = morphing ? (makeupGain(modeFrom, drive.value) - fadingFrom) / frames : 0;

    // the gains and the fades move every sample, the block values are interpolated
    for (let s = 0; s < frames; s++) {
      const t = s + 1;
      drives[s] = driveFrom + driveStep * t;
      levels[s] = levelFrom + levelStep * t;
      opens[s] = open.from + openStep * t;
      const m = morph.from + morphStep * t;
      const to = (makeupFrom + makeupStep * t) * (morphing ? m : 1);
      const from = (fadingFrom + fadingStep * t) * (1 - m);
      for (let q = OVERSAMPLING * s; q < OVERSAMPLING * t; q++) {
        gainsTo[q] = to;
        gainsFrom[q] = from;
      }
    }

    const outputPeak = Math.max(render(left, inL, outL, frames), render(right, inR, outR, frames));

    // the tails of the dc blocker and the tone have died out after the silence: forget the state, skip the
    // next blocks
    if (rungOut && outputPeak < SILENCE) {
      clear();
      idle = true;
    }
  };

  return { set, process };
};
