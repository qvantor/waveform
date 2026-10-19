import {
  BUTTERWORTH_Q,
  createAllpass,
  createBiquad,
  createDelayLine,
  createFixedAllpass,
  createSmoothed,
  peak,
  Smoothed,
  stepAll,
} from './dsp';
import {
  LINE_TIMES,
  lineDecay,
  lineFactor,
  LOOP_ALLPASS_TIMES,
  loopLength,
  sizeFactor,
  XOVER,
} from './reverb-decay';
import { BODY_FREQ, BODY_Q, tube } from './reverb-era';

// the reverb runs in an audio worklet (reverb.worklet.ts), this is its signal processing

export const REVERB_PROCESSOR = 'waveform-reverb';

// the reverb params (FX_PARAMS.reverb) with the era resolved to the values of its input stage
export interface ReverbDspParams {
  lowcut: number;
  pre: number;
  size: number;
  decay: number;
  damp: number;
  bass: number;
  depth: number;
  sep: number;
  er: number;
  // the era: tube drive, input lowpass (Hz, nyquist: the full band) and body boost (dB)
  drive: number;
  bandwidth: number;
  body: number;
}

export interface ReverbOptions {
  params: ReverbDspParams;
  active: boolean;
}

// main thread → worklet: changed params, the active flag
export interface ReverbMessage {
  params?: Partial<ReverbDspParams>;
  active?: boolean;
}

// the ranges the buffers are allocated for (FX_PARAMS.reverb, not imported: it would bundle zod)
export const MAX_PREDELAY = 0.3;
export const MAX_SIZE = 1;
export const MAX_DECAY = 20;

// early reflections: base time (s, scaled by the size) and level, even taps go left, odd ones right
export const ER_TAPS: [number, number][] = [
  [0.0043, 0.9],
  [0.0089, 0.8],
  [0.0131, 0.72],
  [0.0187, 0.63],
  [0.0233, 0.55],
  [0.0301, 0.47],
  [0.0379, 0.4],
  [0.0457, 0.34],
];
// allpass diffusers in series before the lines (Dattorro's input diffusion)
export const DIFFUSER_TIMES = [0.0047, 0.0036, 0.0127, 0.0093];
// allpass gain of the diffusers: a dense tail onset
export const DIFFUSION = 0.55;
// allpass gain inside the lines
export const LOOP_DIFFUSION = 0.5;
// an allpass rings 60 dB down in 60·delay / -20·log10(gain) seconds; for short decays its gain is
// lowered, so it rings at most this part of the decay and the smearing never outlasts the tail
const ALLPASS_RING = 0.5;
// line length modulation (s) at depth 1
export const MOD_DEPTH = 0.0015;
// lfo rate (Hz) of every line, not multiples of each other, so the lines never move together
export const MOD_RATES = [
  0.29, 0.31, 0.37, 0.41, 0.43, 0.47, 0.49, 0.53, 0.57, 0.61, 0.63, 0.67, 0.71, 0.73, 0.79, 0.83,
];
// the lines are summed by channel, half of them per side; the wet level is set by the common mix.
// With the input of a line scaled by sqrt(8 / lines) this keeps the tail level of the first version
// (8 node-based lines tapped before the decay gain), so the saved presets keep their balance
export const TAIL_LEVEL = 0.48;
export const LINE_INPUT = 0.5 * Math.sqrt(8 / LINE_TIMES.length);
// size and predelay changes glide like tape, so a knob drag bends the tail once instead of chirping per step
export const SIZE_GLIDE = 0.1;
// the other params glide like setSmooth
const GLIDE = 0.01;
// below this level (-200 dB) the reverb is silent: the state is cleared and the blocks are skipped
const SILENCE = 1e-10;

// even lines are fed from the left input, odd ones from the right; the sign of the input
// and of the lfo alternates in pairs
export const linePolarity = (i: number) => (i % 4 < 2 ? 1 : -1);

export const allpassGain = (delay: number, decay: number, gain: number) =>
  Math.min(gain, 10 ** ((-3 * delay) / (decay * ALLPASS_RING)));

// input → 2 bandwidth lowpasses (era) → tube (era) → lowcut (highpass, also removes the DC of the
// asymmetric tube) → body (peaking, era) → predelay; the tube gets the band-limited signal, so the
// highs of bright sounds don't intermodulate into whistles
// predelay → mono → absorption (lowpass at hi damp) → ER taps → sides L/R (× er)
// predelay → 4 allpass diffusers → line inputs (L: even lines, R: odd, ± signs)
// line i: gain (decay) → lowshelf (XOVER, bass) → highshelf (damp) → delay (size, lfo i) → allpass (size) → o_i
// feedback (Householder matrix I - 2/N): line input i += o_i - 2/N · Σo
// the tail is tapped after the decay gain and shelves (Jot), so every path is attenuated by its whole
// length: short decays are short from the first echo and the damping colors the tail from its start.
// They are applied before the delay: a new decay changes only what is written, so the tail turns into
// it over one pass instead of jumping by the difference of a pass
// o (even: L, odd: R) × TAIL_LEVEL → sides → width (mid/side, sep) → output
export const createReverbDsp = (sampleRate: number, { params, active: initialActive }: ReverbOptions) => {
  const count = LINE_TIMES.length;
  const maxFactor = sizeFactor(MAX_SIZE);
  const maxLineFactor = lineFactor(MAX_SIZE, MAX_DECAY);
  const samples = (seconds: number) => seconds * sampleRate;

  const param = (key: keyof ReverbDspParams, timeConstant = GLIDE) =>
    createSmoothed(params[key], timeConstant, sampleRate);
  const values: Record<keyof ReverbDspParams, Smoothed> = {
    lowcut: param('lowcut'),
    pre: param('pre', SIZE_GLIDE),
    size: param('size', SIZE_GLIDE),
    decay: param('decay'),
    damp: param('damp'),
    bass: param('bass'),
    depth: param('depth'),
    sep: param('sep'),
    er: param('er'),
    drive: param('drive'),
    bandwidth: param('bandwidth'),
    body: param('body'),
  };
  // the targets of the values, the line scale follows the size and the decay
  const targets = { ...params };
  // the scale of the lines, it glides like the size
  const lineScale = createSmoothed(lineFactor(params.size, params.decay), SIZE_GLIDE, sampleRate);
  let active = initialActive;
  // fades the loops and the output in and out with the active flag
  const fade = createSmoothed(active ? 1 : 0, GLIDE, sampleRate);
  // silent and cleared: blocks are skipped until the input comes back
  let idle = !active;
  // input frames since the last sound, the reverb is silent only after the longest path has drained
  let quietFrames = 0;
  const drainFrames = samples(
    MAX_PREDELAY +
      ER_TAPS[ER_TAPS.length - 1][0] * maxFactor +
      DIFFUSER_TIMES.reduce((a, b) => a + b) +
      Math.max(...LINE_TIMES.map((_, i) => loopLength(i, maxLineFactor)))
  );

  const channels = [0, 1].map(() => ({
    bandwidth: [createBiquad(), createBiquad()],
    lowcut: createBiquad(),
    body: createBiquad(),
    predelay: createDelayLine(samples(MAX_PREDELAY) + 1),
    diffusers: DIFFUSER_TIMES.map((time) => createFixedAllpass(samples(time))),
  }));
  const [left, right] = channels;
  const erAbsorb = createBiquad();
  const erLine = createDelayLine(samples(ER_TAPS[ER_TAPS.length - 1][0] * maxFactor) + 2);
  const erDelays = ER_TAPS.map(([time]) => samples(time));
  const diffuserGains = DIFFUSER_TIMES.map(() => DIFFUSION);
  const lines = LINE_TIMES.map((time, i) => ({
    base: samples(time),
    allpassBase: samples(LOOP_ALLPASS_TIMES[i]),
    delay: createDelayLine(samples(time * maxLineFactor + MOD_DEPTH) + 2),
    allpass: createAllpass(samples(LOOP_ALLPASS_TIMES[i] * maxLineFactor) + 2),
    low: createBiquad(),
    high: createBiquad(),
    input: LINE_INPUT * linePolarity(i),
    gain: 1,
    allpassGain: LOOP_DIFFUSION,
    phase: 0,
    // lfo offset (samples) at the start and the end of the block
    modFrom: 0,
    modTo: 0,
  }));
  const outs = new Float64Array(count);
  const clearables = [
    ...channels.flatMap(({ bandwidth, lowcut, body, predelay, diffusers }) => [
      ...bandwidth,
      lowcut,
      body,
      predelay,
      ...diffusers,
    ]),
    erAbsorb,
    erLine,
    ...lines.flatMap(({ delay, allpass, low, high }) => [delay, allpass, low, high]),
  ];

  const updateInput = () => {
    channels.forEach(({ bandwidth, lowcut, body }) => {
      bandwidth.forEach((node) =>
        node.set('lowpass', { frequency: values.bandwidth.value, Q: BUTTERWORTH_Q, gain: 0 }, sampleRate)
      );
      lowcut.set('highpass', { frequency: values.lowcut.value, Q: BUTTERWORTH_Q, gain: 0 }, sampleRate);
      body.set('peaking', { frequency: BODY_FREQ, Q: BODY_Q, gain: values.body.value }, sampleRate);
    });
  };

  // the gain and both shelves of a line come from the same values and its current length, so the loop
  // never gains above unity, also while the params glide
  const updateDecay = () => {
    const factor = lineScale.value;
    const damp = values.damp.value;
    erAbsorb.set('lowpass', { frequency: damp, Q: BUTTERWORTH_Q, gain: 0 }, sampleRate);
    const decay = values.decay.value;
    DIFFUSER_TIMES.forEach((time, i) => {
      diffuserGains[i] = allpassGain(time, decay, DIFFUSION);
    });
    lines.forEach((line, i) => {
      const { gain, lowDb, highDb } = lineDecay(loopLength(i, factor), decay, values.bass.value);
      line.gain = gain;
      line.allpassGain = allpassGain(LOOP_ALLPASS_TIMES[i] * factor, decay, LOOP_DIFFUSION);
      line.low.set('lowshelf', { frequency: XOVER, Q: 0, gain: lowDb }, sampleRate);
      line.high.set('highshelf', { frequency: damp, Q: 0, gain: highDb }, sampleRate);
    });
  };

  // runs every block: a loop, no closure
  const updateMod = (frames: number) => {
    const depth = values.depth.value * samples(MOD_DEPTH);
    for (let i = 0; i < count; i++) {
      const line = lines[i];
      line.phase = (line.phase + (2 * Math.PI * MOD_RATES[i] * frames) / sampleRate) % (2 * Math.PI);
      line.modFrom = line.modTo;
      line.modTo = linePolarity(i) * depth * Math.sin(line.phase);
    }
  };

  // the values by what they recompute while gliding
  const inputValues = [values.lowcut, values.bandwidth, values.body];
  const decayValues = [lineScale, values.decay, values.bass, values.damp];
  const otherValues = [values.size, values.depth, values.pre, values.sep, values.er, values.drive, fade];

  const snap = () => [...Object.values(values), lineScale].forEach((value) => value.snap());

  const clear = () => {
    clearables.forEach((node) => node.clear());
    lines.forEach((line) => {
      line.modFrom = line.modTo;
    });
  };

  updateInput();
  updateDecay();
  updateMod(0);

  const set = (changes: Partial<ReverbDspParams>) => {
    (Object.keys(changes) as (keyof ReverbDspParams)[]).forEach((key) => {
      const value = changes[key];
      if (!(key in values) || value === undefined) return;
      targets[key] = value;
      values[key].set(value, idle);
    });
    lineScale.set(lineFactor(targets.size, targets.decay), idle);
  };

  const process = (inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array) => {
    const frames = outL.length;
    const inputPeak = Math.max(peak(inL), peak(inR));
    quietFrames = inputPeak < SILENCE ? quietFrames + frames : 0;
    if (idle) {
      if (!active || quietFrames) {
        outL.fill(0);
        outR.fill(0);
        return;
      }
      idle = false;
      snap();
      updateInput();
      updateDecay();
    }

    if (stepAll(inputValues, frames)) updateInput();
    if (stepAll(decayValues, frames)) updateDecay();
    stepAll(otherValues, frames);
    updateMod(frames);

    const { size, pre, sep, er, drive } = values;
    const loopScale = 2 / count;
    let outputPeak = 0;
    for (let s = 0; s < frames; s++) {
      // the delay lengths and the fade move every sample, the block values are interpolated
      const t = (s + 1) / frames;
      const roomScale = sizeFactor(size.from + (size.value - size.from) * t);
      const factor = lineScale.from + (lineScale.value - lineScale.from) * t;
      const predelay = samples(pre.from + (pre.value - pre.from) * t);
      const gain = fade.from + (fade.value - fade.from) * t;

      let l = left.bandwidth[1].process(left.bandwidth[0].process(inL[s]));
      let r = right.bandwidth[1].process(right.bandwidth[0].process(inR[s]));
      l = left.body.process(left.lowcut.process(tube(l, drive.value)));
      r = right.body.process(right.lowcut.process(tube(r, drive.value)));
      const preL = left.predelay.read(predelay);
      const preR = right.predelay.read(predelay);
      left.predelay.write(l);
      right.predelay.write(r);

      let erL = 0;
      let erR = 0;
      for (let i = 0; i < erDelays.length; i++) {
        const tap = ER_TAPS[i][1] * erLine.read(erDelays[i] * roomScale);
        if (i % 2) erR += tap;
        else erL += tap;
      }
      erLine.write(erAbsorb.process((preL + preR) / 2));

      let diffL = preL;
      let diffR = preR;
      for (let i = 0; i < diffuserGains.length; i++) {
        diffL = left.diffusers[i].process(diffL, diffuserGains[i]);
        diffR = right.diffusers[i].process(diffR, diffuserGains[i]);
      }

      let sum = 0;
      let tailL = 0;
      let tailR = 0;
      for (let i = 0; i < count; i++) {
        const line = lines[i];
        const mod = line.modFrom + (line.modTo - line.modFrom) * t;
        const delayed = line.delay.read(line.base * factor + mod);
        const out = line.allpass.process(delayed, line.allpassBase * factor, line.allpassGain);
        outs[i] = out;
        sum += out;
        if (i % 2) tailR += out;
        else tailL += out;
      }
      const feedback = sum * loopScale;
      for (let i = 0; i < count; i++) {
        const line = lines[i];
        const input = (i % 2 ? diffR : diffL) * line.input + outs[i] - feedback;
        line.delay.write(line.high.process(line.low.process(input * line.gain * gain)));
      }

      // mid/side: L = M + w·S, R = M - w·S
      const sideL = er.value * erL + TAIL_LEVEL * tailL;
      const sideR = er.value * erR + TAIL_LEVEL * tailR;
      const width = sep.value;
      const yL = gain * ((sideL * (1 + width)) / 2 + (sideR * (1 - width)) / 2);
      const yR = gain * ((sideR * (1 + width)) / 2 + (sideL * (1 - width)) / 2);
      outL[s] = yL;
      outR[s] = yR;
      outputPeak = Math.max(outputPeak, Math.abs(yL), Math.abs(yR));
    }

    // the inactive reverb has faded out, a quiet one has drained: forget the tail, skip the next blocks
    const faded = !active && fade.value === 0;
    const drained =
      quietFrames > drainFrames && outputPeak < SILENCE && outs.every((value) => Math.abs(value) < SILENCE);
    if (faded || drained) {
      clear();
      idle = true;
    }
  };

  return {
    set,
    // inactive: the loops fade out and the state is cleared, so a stale tail never comes back
    setActive: (value: boolean) => {
      active = value;
      fade.set(value ? 1 : 0);
    },
    process,
    // skipping its blocks (the specs count the work of a silent chain)
    get idle() {
      return idle;
    },
  };
};
