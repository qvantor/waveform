import { mapValues } from 'lodash';
import { FX_PARAMS } from '@waveform/preset-schema';
import { number } from '@waveform/math';
import { FxDefinition } from './types';
import { DelayParam, DELAY_PRESETS } from './delay-presets';
import { setSmooth } from './create-fx-slot';

const { time, fb, mode, pan, freq, q } = FX_PARAMS.delay;

const formatMs = (value: number) => `${Math.round(value * 1000)}ms`;
const formatHz = (value: number) =>
  value >= 1000 ? `${(value / 1000).toFixed(1)}kHz` : `${Math.round(value)}Hz`;

const isPingPong = (value: number) => value >= 0.5;

// input → splitter → in gains → line L/R → bandpass L/R → pan L/R → merger (output)
// feedback: bandpass L/R → fb gains → line L/R; normal: each line feeds itself,
// ping-pong: the mono sum goes into the left line, the lines feed each other (L → R → L)
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
    const bandpass = () => {
      const node = audioCtx.createBiquadFilter();
      node.type = 'bandpass';
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

    const values: Record<DelayParam, number> = mapValues(FX_PARAMS.delay, (param) => param.default);
    let active = true;

    const setValue = (param: AudioParam, value: number) => setSmooth(audioCtx, param, value);

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
      time: (value) => [lines.l, lines.r].forEach((node) => setValue(node.delayTime, value)),
      fb: applyRouting,
      mode: applyRouting,
      pan: (value) => {
        setValue(offsets.l.delayTime, Math.max(0, -value));
        setValue(offsets.r.delayTime, Math.max(0, value));
      },
      freq: (value) => [filters.l, filters.r].forEach((node) => setValue(node.frequency, value)),
      q: (value) => [filters.l, filters.r].forEach((node) => setValue(node.Q, value)),
    };

    (Object.keys(values) as DelayParam[]).forEach((key) => apply[key](values[key]));

    return {
      input,
      output: merger,
      setParam: (key, value) => {
        if (!(key in apply)) return;
        values[key as DelayParam] = value;
        apply[key as DelayParam](value);
      },
      setActive: (value) => {
        active = value;
        applyRouting();
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
