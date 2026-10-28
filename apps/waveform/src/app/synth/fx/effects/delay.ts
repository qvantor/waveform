import { FX_PARAMS } from '@waveform/preset-schema';
import { number } from '@waveform/math';
import { FxDefinition } from './types';
import { DelayParam, DELAY_PRESETS } from './delay-presets';
import { createFxParams } from './fx-params';
import { formatHz, formatMs } from './format';
import { FxModulation } from './fx-modulation';
import { DELAY_LINES, FxModMap } from './fx-mod-params';

const { time, fb, mode, pan, freq, q } = FX_PARAMS.delay;

const isPingPong = (value: number) => value >= 0.5;

// time changes glide like tape (~95% in 0.3s), so a knob drag bends the echoes once instead of chirping per step
const TIME_GLIDE = 0.1;
// the knobs of the nodes with a state (the feedback is the gains: routing)
const NODE_KNOBS: DelayParam[] = ['time', 'pan', 'freq', 'q'];

// input → splitter → in gains → line L/R → bandpass L/R → pan L/R → merger (output)
// feedback: bandpass L/R → fb gains → line L/R; normal: each line feeds itself,
// ping-pong: the mono sum goes into the left line, the lines feed each other (L → R → L).
// clear() makes the nodes with a state (the lines, the bandpasses, the pan offsets) again: a DelayNode can't be
// emptied, fed silence it would still play its last second.
// A knob the envelopes and the LFOs move (fx-modulation.ts) adds a line of fx-mod (fx-mod-params.ts) to its params:
// the offset of its routes from the knob, worked out in the worklet; the knob itself glides as ever (Time with its
// tape glide), Feedback on the gains of the mode, Pan on the delay of the side it is on
export const delay: FxDefinition<DelayParam> = {
  label: 'Delay',
  params: {
    mode: {
      ...mode,
      label: 'Mode',
      options: [
        { id: 'normal', label: 'Normal' },
        { id: 'ping-pong', label: 'Ping-pong' },
      ],
    },
    pan: {
      ...pan,
      label: 'Pan',
      name: 'Stereo offset',
      precision: 1000,
      fillFrom: 0,
      formatValue: (value) => {
        const ms = Math.round(value * 1000);
        if (ms === 0) return '0ms';
        return `${ms < 0 ? 'L' : 'R'} ${Math.abs(ms)}ms`;
      },
    },
    time: {
      ...time,
      label: 'Time',
      name: 'Delay time',
      formatValue: formatMs,
    },
    fb: {
      ...fb,
      label: 'Feedback',
      precision: 100,
      formatValue: number.percent,
    },
    freq: {
      ...freq,
      label: 'Freq',
      name: 'Filter freq',
      mode: 'log',
      precision: 1,
      formatValue: formatHz,
    },
    q: {
      ...q,
      label: 'Q',
      name: 'Resonance',
      mode: 'log',
      precision: 100,
    },
  },
  presets: DELAY_PRESETS,
  create: (audioCtx, fxMod) => {
    // mono input is upmixed to both channels
    const input = audioCtx.createGain();
    input.channelCount = 2;
    input.channelCountMode = 'explicit';
    input.channelInterpretation = 'speakers';
    const splitter = audioCtx.createChannelSplitter(2);
    const merger = audioCtx.createChannelMerger(2);

    const gain = () => audioCtx.createGain();
    const line = () => audioCtx.createDelay(time.max);
    // its Freq and Q k-rate: automated a-rate (an envelope, a knob gliding) Chrome and WebKit work the
    // coefficients out every sample, twice the cost of the filter (scripts/bench-osc, biquad); once per block
    // a sweep of the feedback loop doesn't step audibly
    const bandpass = () => {
      const node = audioCtx.createBiquadFilter();
      node.type = 'bandpass';
      [node.frequency, node.Q].forEach((param) => {
        // a browser that has no automationRate keeps a-rate
        try {
          param.automationRate = 'k-rate';
        } catch {
          // a-rate
        }
      });
      return node;
    };

    // the nodes with a state, made again by clear()
    const stateful = () => ({
      lines: { l: line(), r: line() },
      filters: { l: bandpass(), r: bandpass() },
      offsets: { l: audioCtx.createDelay(pan.max), r: audioCtx.createDelay(pan.max) },
    });
    let { lines: lines_, filters, offsets } = stateful();
    // inX: right input into the left line (ping-pong mono sum)
    const inputs = { l: gain(), r: gain(), x: gain() };
    // ll/rr: a line into itself, lr/rl: into the other line
    const feedbacks = { ll: gain(), rr: gain(), lr: gain(), rl: gain() };

    input.connect(splitter);
    splitter.connect(inputs.l, 0);
    splitter.connect(inputs.r, 1);
    splitter.connect(inputs.x, 1);
    // the gains into and out of the nodes with a state
    const wire = () => {
      inputs.l.connect(lines_.l);
      inputs.x.connect(lines_.l);
      inputs.r.connect(lines_.r);
      lines_.l.connect(filters.l);
      lines_.r.connect(filters.r);
      filters.l.connect(feedbacks.ll).connect(lines_.l);
      filters.r.connect(feedbacks.rr).connect(lines_.r);
      filters.l.connect(feedbacks.lr).connect(lines_.r);
      filters.r.connect(feedbacks.rl).connect(lines_.l);
      filters.l.connect(offsets.l).connect(merger, 0, 0);
      filters.r.connect(offsets.r).connect(merger, 0, 1);
    };
    wire();
    // the nodes in between: those with a state and the gains into and out of them
    const inner = (): AudioNode[] => [
      ...Object.values(inputs),
      ...Object.values(feedbacks),
      ...Object.values(lines_),
      ...Object.values(filters),
      ...Object.values(offsets),
    ];

    const { values, setValue, bind, instantly } = createFxParams(audioCtx, FX_PARAMS.delay);
    let active = true;

    // inactive: no feedback, so the lines drain within one delay time instead of ringing on
    const applyRouting = () => {
      const pingPong = isPingPong(values.mode);
      const feedback = active ? values.fb : 0;
      setValue(inputs.l.gain, pingPong ? 0.5 : 1);
      setValue(inputs.x.gain, pingPong ? 0.5 : 0);
      setValue(inputs.r.gain, pingPong ? 0 : 1);
      setValue(feedbacks.ll.gain, pingPong ? 0 : feedback);
      setValue(feedbacks.rr.gain, pingPong ? 0 : feedback);
      setValue(feedbacks.lr.gain, pingPong ? feedback : 0);
      setValue(feedbacks.rl.gain, pingPong ? feedback : 0);
    };

    const apply: Record<DelayParam, (value: number) => void> = {
      time: (value) => [lines_.l, lines_.r].forEach((node) => setValue(node.delayTime, value, TIME_GLIDE)),
      fb: applyRouting,
      mode: applyRouting,
      pan: (value) => {
        // the earlier channel sets the side: L (< 0) delays the right channel
        setValue(offsets.l.delayTime, Math.max(0, value));
        setValue(offsets.r.delayTime, Math.max(0, -value));
      },
      freq: (value) => [filters.l, filters.r].forEach((node) => setValue(node.frequency, value)),
      q: (value) => [filters.l, filters.r].forEach((node) => setValue(node.Q, value)),
    };

    // the routes of the knobs (null: none): each knob they move is a line of fx-mod on its params, the offset of
    // the routes from the knob (the feedback on the gains of a line into itself, and on those into the other one
    // for ping-pong, each while its mode is on and the delay active: another mode glides one out and the other in
    // as the gains glide; the pan on the delay of each side); the params stay at the knobs with their glides
    let modulation: FxModulation | null = null;
    const routesOf = (key: DelayParam) => modulation?.routes.filter(({ param }) => param === key) ?? [];
    const lines: [number, DelayParam, FxModMap, () => AudioParam[]][] = [
      [DELAY_LINES.time, 'time', 'linear', () => [lines_.l.delayTime, lines_.r.delayTime]],
      [
        DELAY_LINES.fb,
        'fb',
        'linear',
        () => (active && !isPingPong(values.mode) ? [feedbacks.ll.gain, feedbacks.rr.gain] : []),
      ],
      [
        DELAY_LINES.fbX,
        'fb',
        'linear',
        () => (active && isPingPong(values.mode) ? [feedbacks.lr.gain, feedbacks.rl.gain] : []),
      ],
      [DELAY_LINES.panL, 'pan', 'panL', () => [offsets.l.delayTime]],
      [DELAY_LINES.panR, 'pan', 'panR', () => [offsets.r.delayTime]],
      [DELAY_LINES.freq, 'freq', 'linear', () => [filters.l.frequency, filters.r.frequency]],
      [DELAY_LINES.q, 'q', 'linear', () => [filters.l.Q, filters.r.Q]],
    ];
    // the lines of the knobs their routes move (of `key`: of that knob only)
    const follow = (key?: DelayParam) =>
      lines.forEach(([index, knob, map, params]) => {
        if (!fxMod || (key && knob !== key)) return;
        const routes = routesOf(knob);
        const targets = params();
        fxMod.set(
          index,
          routes.length > 0 && targets.length > 0 ? { routes, base: values[knob], map } : null,
          targets
        );
      });

    const setParam = bind({
      ...apply,
      time: (value) => {
        apply.time(value);
        follow('time');
      },
      fb: (value) => {
        apply.fb(value);
        follow('fb');
      },
      mode: (value) => {
        apply.mode(value);
        follow('fb');
      },
      pan: (value) => {
        apply.pan(value);
        follow('pan');
      },
      freq: (value) => {
        apply.freq(value);
        follow('freq');
      },
      q: (value) => {
        apply.q(value);
        follow('q');
      },
    });

    return {
      input,
      output: merger,
      setParam,
      setActive: (value) => {
        active = value;
        applyRouting();
        follow('fb');
      },
      setModulation: (mod) => {
        modulation = mod;
        follow();
      },
      // new nodes at the values of their knobs at once (from their defaults a Time would chirp), the lines of the
      // routes on their params; the gains keep theirs
      clear: () => {
        inner().forEach((node) => node.disconnect());
        ({ lines: lines_, filters, offsets } = stateful());
        wire();
        instantly(() => NODE_KNOBS.forEach((key) => apply[key](values[key])));
        follow();
      },
      destroy: () => [input, splitter, merger, ...inner()].forEach((node) => node.disconnect()),
    };
  },
};
