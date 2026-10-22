import { FX_PARAMS } from '@waveform/preset-schema';
import { number } from '@waveform/math';
import { FxDefinition } from './types';
import { DelayParam, DELAY_PRESETS } from './delay-presets';
import { createFxParams } from './fx-params';
import { formatHz, formatMs } from './format';
import { FxModulation } from './fx-modulation';
import { FxRamp, holdParam, scheduleRouted } from './fx-automation';

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

    // the nodes with a state, made again by clear()
    const stateful = () => ({
      lines: { l: line(), r: line() },
      filters: { l: bandpass(), r: bandpass() },
      offsets: { l: audioCtx.createDelay(pan.max), r: audioCtx.createDelay(pan.max) },
    });
    let { lines, filters, offsets } = stateful();
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
    };
    wire();
    // the nodes in between: those with a state and the gains into and out of them
    const inner = (): AudioNode[] => [
      ...Object.values(inputs),
      ...Object.values(feedbacks),
      ...Object.values(lines),
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
    // a knob its routes move is automated (true), else it is left to its value
    const automateRoutes = (key: DelayParam) => {
      const routes = routesOf(key);
      if (!modulation || routes.length === 0) return false;
      const { note } = modulation;
      automated[key]?.().forEach(([param, ramp, map]) =>
        scheduleRouted(param, audioCtx.currentTime, note, routes, values[key], ramp, map)
      );
      return true;
    };
    // a knob moved by its routes is automated, else it glides to its value
    const routed = (key: DelayParam, set: (value: number) => void) => (value: number) => {
      if (!automateRoutes(key)) set(value);
    };
    // the feedback gains follow the automation of the routes of Feedback
    let fbRouted = false;
    // the mode and the active flag set every feedback gain: a moved feedback leaves its automation on all of them
    // first (after a mode change the gains of the old one would go on ramping: both loops would feed back), then
    // it is automated again on the gains of the mode; inactive it isn't, the lines drain
    const routing = () => {
      if (fbRouted) Object.values(feedbacks).forEach(({ gain }) => holdParam(gain, audioCtx.currentTime));
      applyRouting();
      fbRouted = active && automateRoutes('fb');
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
        if (fbRouted || routesOf('fb').length > 0) routing();
        NODE_KNOBS.forEach((key) => {
          if (automateRoutes(key) || !before.has(key)) return;
          // its routes are gone: from where it is to its value
          automated[key]?.().forEach(([param]) => holdParam(param, audioCtx.currentTime));
          apply[key](values[key]);
        });
      },
      // new nodes at the values of their knobs at once (from their defaults a Time would chirp), those the
      // routes move automated again from there; the gains keep theirs
      clear: () => {
        inner().forEach((node) => node.disconnect());
        ({ lines, filters, offsets } = stateful());
        wire();
        instantly(() => NODE_KNOBS.forEach((key) => apply[key](values[key])));
        NODE_KNOBS.forEach(automateRoutes);
      },
      destroy: () => [input, splitter, merger, ...inner()].forEach((node) => node.disconnect()),
    };
  },
};
