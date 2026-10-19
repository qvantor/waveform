import { FX_PARAMS } from '@waveform/preset-schema';
import { number } from '@waveform/math';
import { FxDefinition } from './types';
import { DelayParam, DELAY_PRESETS } from './delay-presets';
import { createFxParams } from './fx-params';
import { formatHz, formatMs } from './format';
import { FxModulation, FxNote, FxRoute } from './fx-modulation';
import { FxRamp, holdParam, scheduleRouted } from './fx-automation';

const { time, fb, mode, pan, freq, q } = FX_PARAMS.delay;

const isPingPong = (value: number) => value >= 0.5;

// time changes glide like tape (~95% in 0.3s), so a knob drag bends the echoes once instead of chirping per step
const TIME_GLIDE = 0.1;

// input → splitter → in gains → line L/R → bandpass L/R → pan L/R → merger (output)
// feedback: bandpass L/R → fb gains → line L/R; normal: each line feeds itself,
// ping-pong: the mono sum goes into the left line, the lines feed each other (L → R → L).
// A knob the envelopes move (fx-modulation.ts) is automated, base + amount × level: linear ramps, exponential
// ones for Freq and Q; Time without its tape glide (a fast envelope would be smoothed away), Feedback on the
// gains of the mode, Pan on the delay of the side it is on
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
      mode: 'log',
      precision: 1,
      formatValue: formatHz,
    },
    q: {
      ...q,
      label: 'Q',
      mode: 'log',
      precision: 100,
    },
  },
  presets: DELAY_PRESETS,
  create: (audioCtx) => {
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

    const lines = { l: line(), r: line() };
    const filters = { l: bandpass(), r: bandpass() };
    const offsets = { l: audioCtx.createDelay(pan.max), r: audioCtx.createDelay(pan.max) };
    // inX: right input into the left line (ping-pong mono sum)
    const inputs = { l: gain(), r: gain(), x: gain() };
    // ll/rr: a line into itself, lr/rl: into the other line
    const feedbacks = { ll: gain(), rr: gain(), lr: gain(), rl: gain() };

    input.connect(splitter);
    splitter.connect(inputs.l, 0);
    splitter.connect(inputs.r, 1);
    splitter.connect(inputs.x, 1);
    inputs.l.connect(lines.l);
    inputs.x.connect(lines.l);
    inputs.r.connect(lines.r);
    lines.l.connect(filters.l);
    lines.r.connect(filters.r);
    filters.l.connect(feedbacks.ll).connect(lines.l);
    filters.r.connect(feedbacks.rr).connect(lines.r);
    filters.l.connect(feedbacks.lr).connect(lines.r);
    filters.r.connect(feedbacks.rl).connect(lines.l);
    filters.l.connect(offsets.l).connect(merger, 0, 0);
    filters.r.connect(offsets.r).connect(merger, 0, 1);

    const { values, setValue, bind } = createFxParams(audioCtx, FX_PARAMS.delay);
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
      time: (value) => [lines.l, lines.r].forEach((node) => setValue(node.delayTime, value, TIME_GLIDE)),
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

    // the routes of the knobs and the note they follow (null: none)
    let modulation: FxModulation | null = null;
    const routesOf = (key: DelayParam) => modulation?.routes.filter(({ param }) => param === key) ?? [];
    // the params of each knob the envelopes move, the ramp and the map of the knob to each of them
    const automated: Partial<Record<DelayParam, () => [AudioParam, FxRamp, ((value: number) => number)?][]>> =
      {
        time: () => [lines.l, lines.r].map((node) => [node.delayTime, 'linear']),
        fb: () =>
          (isPingPong(values.mode) ? [feedbacks.lr, feedbacks.rl] : [feedbacks.ll, feedbacks.rr]).map(
            (node) => [node.gain, 'linear']
          ),
        pan: () => [
          [offsets.l.delayTime, 'curve', (value) => Math.max(0, value)],
          [offsets.r.delayTime, 'curve', (value) => Math.max(0, -value)],
        ],
        freq: () => [filters.l, filters.r].map((node) => [node.frequency, 'exponential']),
        q: () => [filters.l, filters.r].map((node) => [node.Q, 'exponential']),
      };
    // every param a knob may move (the feedback gains of both modes)
    const paramsOf: Partial<Record<DelayParam, AudioParam[]>> = {
      time: [lines.l.delayTime, lines.r.delayTime],
      fb: Object.values(feedbacks).map((node) => node.gain),
      pan: [offsets.l.delayTime, offsets.r.delayTime],
      freq: [filters.l.frequency, filters.r.frequency],
      q: [filters.l.Q, filters.r.Q],
    };
    const automate = (key: DelayParam, routes: FxRoute[], note: FxNote) =>
      automated[key]?.().forEach(([param, ramp, map]) =>
        scheduleRouted(param, audioCtx.currentTime, note, routes, values[key], ramp, map)
      );
    // a knob moved by its routes is automated, else it glides to its value
    const routed = (key: DelayParam, set: (value: number) => void) => (value: number) => {
      const routes = routesOf(key);
      if (modulation && routes.length > 0) automate(key, routes, modulation.note);
      else set(value);
    };
    // the mode and the active flag set every feedback gain: a moved feedback is automated again
    const routing = () => {
      applyRouting();
      const routes = routesOf('fb');
      if (modulation && routes.length > 0) automate('fb', routes, modulation.note);
    };

    const setParam = bind({
      ...apply,
      time: routed('time', apply.time),
      fb: routing,
      mode: routing,
      pan: routed('pan', apply.pan),
      freq: routed('freq', apply.freq),
      q: routed('q', apply.q),
    });

    return {
      input,
      output: merger,
      setParam,
      setActive: (value) => {
        active = value;
        routing();
      },
      setModulation: (mod) => {
        const before = new Set(modulation?.routes.map(({ param }) => param));
        modulation = mod;
        (Object.keys(paramsOf) as DelayParam[]).forEach((key) => {
          const routes = routesOf(key);
          if (mod && routes.length > 0) {
            automate(key, routes, mod.note);
            return;
          }
          if (!before.has(key)) return;
          // its routes are gone: from where it is to its value
          paramsOf[key]?.forEach((param) => holdParam(param, audioCtx.currentTime));
          if (key === 'fb') applyRouting();
          else apply[key](values[key]);
        });
      },
      destroy: () =>
        [
          input,
          splitter,
          merger,
          ...Object.values(lines),
          ...Object.values(filters),
          ...Object.values(offsets),
          ...Object.values(inputs),
          ...Object.values(feedbacks),
        ].forEach((node) => node.disconnect()),
    };
  },
};
