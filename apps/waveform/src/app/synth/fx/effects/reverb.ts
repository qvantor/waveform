import { FX_PARAMS } from '@waveform/preset-schema';
import { number } from '@waveform/math';
import { FxDefinition } from './types';
import { ReverbParam, REVERB_PRESETS } from './reverb-presets';
import { createFxParams } from './fx-params';
import { formatHz, formatMs, formatSeconds } from './format';
import { LINE_TIMES, lineDecay, sizeFactor, XOVER } from './reverb-decay';
import { BODY_FREQ, BODY_Q, eraIndex, REVERB_ERAS, tubeCurve, TUBE_RANGE } from './reverb-era';

const { lowcut, pre, size, decay, damp, bass, depth, sep, er, era } = FX_PARAMS.reverb;

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
// allpass diffusers in series, longer than a render quantum (128 samples), so their loops work
export const DIFFUSER_TIMES = [0.0047, 0.0036, 0.0127, 0.0093];
const MAX_DIFFUSER_TIME = Math.max(...DIFFUSER_TIMES);
// allpass gain of the diffusers: a dense tail onset
export const DIFFUSION = 0.55;
// line length modulation (s) at depth 1
export const MOD_DEPTH = 0.0015;
// lfo rate (Hz) of every line, not multiples of each other, so the lines never move together
export const MOD_RATES = [0.31, 0.37, 0.43, 0.49, 0.57, 0.63, 0.71, 0.79];
// the lines are summed by channel, 4 per side; the wet level is set by the common mix
export const TAIL_LEVEL = 0.4;
// butterworth: Q of highpass and lowpass is in dB
const BUTTERWORTH_Q = -3.01;
// size changes glide like tape, so a knob drag bends the tail once instead of chirping per step
const SIZE_GLIDE = 0.1;

const MAX_SIZE_FACTOR = sizeFactor(size.max);

// even lines are fed from the left input, odd ones from the right; the sign of the input
// and of the lfo alternates in pairs
const linePolarity = (i: number) => (i % 4 < 2 ? 1 : -1);

// input → 2ch upmix (scaled to the tube curve range) → 2 bandwidth lowpasses (era) → tube (waveshaper, era)
// → lowcut (highpass, also removes the DC of the asymmetric curve) → body (peaking, era) → predelay;
// the tube gets the band-limited signal, so the highs of bright sounds don't intermodulate or alias into whistles
// predelay → mono → absorption (lowpass at hi damp) → ER taps (delay → level) → sides L/R (er gains)
// predelay → 4 allpass diffusers → splitter → line inputs (L: even lines, R: odd, ± signs)
// line i: sum → delay (size, lfo i) → lowshelf (XOVER, bass) → highshelf (damp) → feedback gain (decay) → y
// feedback (Householder matrix I - 2/N): y_i → sum_i, every y → bus (-2/N) → every sum
// lines → tail gains → sides L/R → width matrix (sep) → merger (output)
export const reverb: FxDefinition<ReverbParam> = {
  label: 'Reverb',
  params: {
    lowcut: { ...lowcut, label: 'Low cut', mode: 'log', precision: 1, formatValue: formatHz },
    pre: { ...pre, label: 'Predelay', precision: 1000, formatValue: formatMs },
    size: { ...size, label: 'Size', precision: 100, formatValue: number.percent },
    decay: { ...decay, label: 'Decay', mode: 'log', precision: 100, formatValue: formatSeconds },
    damp: { ...damp, label: 'Hi damp', mode: 'log', precision: 1, formatValue: formatHz },
    bass: {
      ...bass,
      label: 'Bass',
      mode: 'log',
      precision: 100,
      formatValue: (value) => `×${value.toFixed(2)}`,
    },
    // the levels are faders, the stereo width fills from its natural 100%
    depth: { ...depth, label: 'Mod', control: 'fader', precision: 100, formatValue: number.percent },
    sep: { ...sep, label: 'Sep', control: 'fader', fillFrom: 1, precision: 100, formatValue: number.percent },
    er: { ...er, label: 'ER', control: 'fader', precision: 100, formatValue: number.percent },
    era: { ...era, label: 'Era', options: REVERB_ERAS },
  },
  presets: REVERB_PRESETS,
  create: (audioCtx) => {
    const gain = () => audioCtx.createGain();
    const filter = (type: BiquadFilterType) => {
      const node = audioCtx.createBiquadFilter();
      node.type = type;
      return node;
    };

    // mono input is upmixed to both channels
    const input = gain();
    input.channelCount = 2;
    input.channelCountMode = 'explicit';
    input.channelInterpretation = 'speakers';
    const tube = audioCtx.createWaveShaper();
    tube.oversample = '4x';
    const lowcutFilter = filter('highpass');
    const bandwidth = [filter('lowpass'), filter('lowpass')];
    const body = filter('peaking');
    const predelay = audioCtx.createDelay(pre.max);
    const curves = REVERB_ERAS.map(({ drive }) => tubeCurve(drive));

    // early reflections from the mono sum
    const erIn = gain();
    erIn.channelCount = 1;
    erIn.channelCountMode = 'explicit';
    erIn.channelInterpretation = 'speakers';
    const erAbsorb = filter('lowpass');
    const erTaps = ER_TAPS.map(([time]) => ({
      delay: audioCtx.createDelay(time * MAX_SIZE_FACTOR),
      level: gain(),
    }));
    const erLevels = { l: gain(), r: gain() };

    // allpass: sum = x + g·delayed, out = -g·sum + delayed
    const diffusers = DIFFUSER_TIMES.map(() => ({
      sum: gain(),
      delay: audioCtx.createDelay(MAX_DIFFUSER_TIME),
      fb: gain(),
      ff: gain(),
      out: gain(),
    }));
    const splitter = audioCtx.createChannelSplitter(2);

    const lines = LINE_TIMES.map((time) => ({
      in: gain(),
      sum: gain(),
      delay: audioCtx.createDelay(time * MAX_SIZE_FACTOR + MOD_DEPTH),
      low: filter('lowshelf'),
      high: filter('highshelf'),
      fb: gain(),
      lfo: audioCtx.createOscillator(),
      mod: gain(),
    }));
    const bus = gain();
    const tailLevels = { l: gain(), r: gain() };

    const sides = { l: gain(), r: gain() };
    // ll/rr: a side into its own channel, lr/rl: into the other one
    const widths = { ll: gain(), rr: gain(), lr: gain(), rl: gain() };
    const merger = audioCtx.createChannelMerger(2);

    bandwidth
      .reduce<AudioNode>((prev, node) => prev.connect(node), input)
      .connect(tube)
      .connect(lowcutFilter)
      .connect(body)
      .connect(predelay);

    predelay.connect(erIn).connect(erAbsorb);
    erTaps.forEach(({ delay, level }, i) => {
      erAbsorb
        .connect(delay)
        .connect(level)
        .connect(i % 2 ? erLevels.r : erLevels.l);
    });

    diffusers
      .reduce<AudioNode>((prev, { sum, delay, fb, ff, out }) => {
        prev.connect(sum);
        sum.connect(delay).connect(fb).connect(sum);
        sum.connect(ff).connect(out);
        delay.connect(out);
        return out;
      }, predelay)
      .connect(splitter);

    lines.forEach((line, i) => {
      splitter.connect(line.in, i % 2);
      line.in.connect(line.sum);
      line.sum.connect(line.delay).connect(line.low).connect(line.high).connect(line.fb);
      line.fb.connect(line.sum);
      line.fb.connect(bus);
      bus.connect(line.sum);
      line.lfo.connect(line.mod).connect(line.delay.delayTime);
      line.lfo.start();
      line.delay.connect(i % 2 ? tailLevels.r : tailLevels.l);
    });

    erLevels.l.connect(sides.l);
    tailLevels.l.connect(sides.l);
    erLevels.r.connect(sides.r);
    tailLevels.r.connect(sides.r);
    sides.l.connect(widths.ll).connect(merger, 0, 0);
    sides.l.connect(widths.lr).connect(merger, 0, 1);
    sides.r.connect(widths.rr).connect(merger, 0, 1);
    sides.r.connect(widths.rl).connect(merger, 0, 0);

    const { values, setValue, bind } = createFxParams(audioCtx, FX_PARAMS.reverb);
    let active = true;

    // fixed gains, set once
    setValue(input.gain, 1 / TUBE_RANGE);
    [lowcutFilter, ...bandwidth, erAbsorb].forEach((node) => setValue(node.Q, BUTTERWORTH_Q));
    setValue(body.frequency, BODY_FREQ);
    setValue(body.Q, BODY_Q);
    setValue(bus.gain, -2 / lines.length);
    erTaps.forEach(({ level }, i) => setValue(level.gain, ER_TAPS[i][1]));
    diffusers.forEach(({ delay, fb, ff }, i) => {
      setValue(delay.delayTime, DIFFUSER_TIMES[i]);
      setValue(fb.gain, DIFFUSION);
      setValue(ff.gain, -DIFFUSION);
    });
    lines.forEach((line, i) => {
      setValue(line.in.gain, 0.5 * linePolarity(i));
      setValue(line.low.frequency, XOVER);
      setValue(line.lfo.frequency, MOD_RATES[i]);
    });
    [tailLevels.l, tailLevels.r].forEach((node) => setValue(node.gain, TAIL_LEVEL));

    // inactive: no feedback, so the lines drain within one pass instead of ringing on
    const applyDecay = () => {
      const factor = sizeFactor(values.size);
      lines.forEach((line, i) => {
        const { gain, lowDb, highDb } = lineDecay(LINE_TIMES[i] * factor, values.decay, values.bass);
        setValue(line.fb.gain, active ? gain : 0);
        setValue(line.low.gain, lowDb);
        setValue(line.high.gain, highDb);
      });
    };

    const apply: Record<ReverbParam, (value: number) => void> = {
      lowcut: (value) => setValue(lowcutFilter.frequency, value),
      pre: (value) => setValue(predelay.delayTime, value),
      size: (value) => {
        const factor = sizeFactor(value);
        lines.forEach((line, i) => setValue(line.delay.delayTime, LINE_TIMES[i] * factor, SIZE_GLIDE));
        erTaps.forEach(({ delay }, i) => setValue(delay.delayTime, ER_TAPS[i][0] * factor, SIZE_GLIDE));
        applyDecay();
      },
      decay: applyDecay,
      bass: applyDecay,
      // the walls absorb the highs of the reflections like the tail loses them
      damp: (value) =>
        [erAbsorb, ...lines.map((line) => line.high)].forEach((node) => setValue(node.frequency, value)),
      depth: (value) =>
        lines.forEach((line, i) => setValue(line.mod.gain, linePolarity(i) * value * MOD_DEPTH)),
      // mid/side: L = M + w·S, R = M - w·S
      sep: (value) => {
        [widths.ll, widths.rr].forEach((node) => setValue(node.gain, (1 + value) / 2));
        [widths.lr, widths.rl].forEach((node) => setValue(node.gain, (1 - value) / 2));
      },
      er: (value) => [erLevels.l, erLevels.r].forEach((node) => setValue(node.gain, value)),
      // now: a straight curve and lowpasses at nyquist (they pass everything), so the input stays clean
      era: (value) => {
        const index = eraIndex(value);
        const current = REVERB_ERAS[index];
        tube.curve = curves[index];
        bandwidth.forEach((node) => setValue(node.frequency, current.bandwidth ?? audioCtx.sampleRate / 2));
        setValue(body.gain, current.body);
      },
    };

    const setParam = bind(apply);

    return {
      input,
      output: merger,
      setParam,
      setActive: (value) => {
        active = value;
        applyDecay();
      },
      destroy: () => {
        lines.forEach(({ lfo }) => lfo.stop());
        [
          input,
          tube,
          lowcutFilter,
          ...bandwidth,
          body,
          predelay,
          erIn,
          erAbsorb,
          ...erTaps.flatMap(Object.values),
          ...Object.values(erLevels),
          ...diffusers.flatMap(Object.values),
          splitter,
          ...lines.flatMap(Object.values),
          bus,
          ...Object.values(tailLevels),
          ...Object.values(sides),
          ...Object.values(widths),
          merger,
        ].forEach((node: AudioNode) => node.disconnect());
      },
    };
  },
};
