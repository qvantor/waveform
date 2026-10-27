import { delay } from './delay';
import type { FxMod } from './fx-mod';
import { DELAY_LINES } from './fx-mod-params';

// the gains are found through the graph: the mocked createDelay also creates a gain for delayTime
const setup = () => {
  const audioCtx = new AudioContext();
  const createDelay = jest.spyOn(audioCtx, 'createDelay');
  const createBiquadFilter = jest.spyOn(audioCtx, 'createBiquadFilter');
  const createChannelSplitter = jest.spyOn(audioCtx, 'createChannelSplitter');
  const createChannelMerger = jest.spyOn(audioCtx, 'createChannelMerger');
  const core = delay.create(audioCtx);

  const results = <T>(spy: jest.SpyInstance) => spy.mock.results.map(({ value }) => value as T);
  const targets = (node: AudioNode) => (node.connect as jest.Mock).mock.calls.map(([target]) => target);
  const [lineL, lineR, offL, offR] = results<DelayNode>(createDelay);
  const [bpL, bpR] = results<BiquadFilterNode>(createBiquadFilter);
  const [splitter] = results<ChannelSplitterNode>(createChannelSplitter);
  const [merger] = results<ChannelMergerNode>(createChannelMerger);
  const [inL, inR, inX] = targets(splitter) as GainNode[];
  const [fbLL, fbLR] = targets(bpL) as GainNode[];
  const [fbRR, fbRL] = targets(bpR) as GainNode[];

  return {
    core,
    createDelay,
    createBiquadFilter,
    input: core.input as GainNode,
    splitter,
    merger,
    lines: [lineL, lineR],
    offsets: [offL, offR],
    filters: [bpL, bpR],
    inputs: { l: inL, r: inR, x: inX },
    feedbacks: { ll: fbLL, rr: fbRR, lr: fbLR, rl: fbRL },
  };
};

// changes after create are smoothed, the initial values are set instantly
const lastValue = (param: AudioParam) => (param.setTargetAtTime as jest.Mock).mock.lastCall?.[0];
const initialValue = (param: AudioParam) => {
  expect(param.setTargetAtTime).not.toHaveBeenCalled();
  return (param.setValueAtTime as jest.Mock).mock.lastCall?.[0];
};
const initialGains = (nodes: Record<string, GainNode>) =>
  Object.fromEntries(Object.entries(nodes).map(([key, node]) => [key, initialValue(node.gain)]));
const gains = (nodes: Record<string, GainNode>) =>
  Object.fromEntries(Object.entries(nodes).map(([key, node]) => [key, lastValue(node.gain)]));

describe('delay', () => {
  it('upmixes the input to stereo and outputs the merger', () => {
    const { core, input, splitter, merger } = setup();
    expect(core.output).toBe(merger);
    expect(input).toMatchObject({
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
    expect(input.connect).toHaveBeenCalledWith(splitter);
  });

  it('wires the lines through the bandpass filters, the feedback paths and the offsets', () => {
    const { splitter, lines, filters, offsets, merger, inputs, feedbacks } = setup();
    expect((splitter.connect as jest.Mock).mock.calls).toEqual([
      [inputs.l, 0],
      [inputs.r, 1],
      [inputs.x, 1],
    ]);
    expect(inputs.l.connect).toHaveBeenCalledWith(lines[0]);
    expect(inputs.x.connect).toHaveBeenCalledWith(lines[0]);
    expect(inputs.r.connect).toHaveBeenCalledWith(lines[1]);
    expect(lines[0].connect).toHaveBeenCalledWith(filters[0]);
    expect(lines[1].connect).toHaveBeenCalledWith(filters[1]);
    expect(filters[0].connect).toHaveBeenCalledWith(feedbacks.ll);
    expect(filters[0].connect).toHaveBeenCalledWith(feedbacks.lr);
    expect(filters[1].connect).toHaveBeenCalledWith(feedbacks.rr);
    expect(filters[1].connect).toHaveBeenCalledWith(feedbacks.rl);
    expect(feedbacks.ll.connect).toHaveBeenCalledWith(lines[0]);
    expect(feedbacks.rl.connect).toHaveBeenCalledWith(lines[0]);
    expect(feedbacks.rr.connect).toHaveBeenCalledWith(lines[1]);
    expect(feedbacks.lr.connect).toHaveBeenCalledWith(lines[1]);
    expect(offsets[0].connect).toHaveBeenCalledWith(merger, 0, 0);
    expect(offsets[1].connect).toHaveBeenCalledWith(merger, 0, 1);
    filters.forEach((filter) => expect(filter.type).toBe('bandpass'));
  });

  it('sets the defaults instantly on create, so the feedback never ramps down from gain 1', () => {
    const { lines, filters, offsets, inputs, feedbacks } = setup();
    lines.forEach((line) => expect(initialValue(line.delayTime)).toBe(0.2));
    offsets.forEach((offset) => expect(initialValue(offset.delayTime)).toBe(0));
    filters.forEach((filter) => {
      expect(initialValue(filter.frequency)).toBe(1000);
      expect(initialValue(filter.Q)).toBe(0.01);
    });
    expect(initialGains(inputs)).toEqual({ l: 1, r: 1, x: 0 });
    expect(initialGains(feedbacks)).toEqual({ ll: 0.5, rr: 0.5, lr: 0, rl: 0 });
    expect(feedbacks.ll.gain.setValueAtTime).toHaveBeenCalledWith(0.5, 0);
  });

  it('smooths changes after create', () => {
    const { core, lines, feedbacks } = setup();
    const created = (feedbacks.ll.gain.setValueAtTime as jest.Mock).mock.calls.length;
    core.setParam('time', 0.3);
    core.setActive(false);
    lines.forEach((line) =>
      expect(line.delayTime.setTargetAtTime).toHaveBeenLastCalledWith(0.3, 0, expect.any(Number))
    );
    expect(feedbacks.ll.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, expect.any(Number));
    expect(feedbacks.ll.gain.setValueAtTime).toHaveBeenCalledTimes(created);
  });

  it('glides time slowly like tape, the other params stay fast', () => {
    const { core, lines, offsets, filters, feedbacks } = setup();
    core.setParam('time', 0.5);
    core.setParam('pan', 0.01);
    core.setParam('freq', 2000);
    core.setParam('q', 1);
    core.setParam('fb', 0.4);
    lines.forEach((line) => expect(line.delayTime.setTargetAtTime).toHaveBeenLastCalledWith(0.5, 0, 0.1));
    expect(offsets[0].delayTime.setTargetAtTime).toHaveBeenLastCalledWith(0.01, 0, 0.01);
    filters.forEach((filter) => {
      expect(filter.frequency.setTargetAtTime).toHaveBeenLastCalledWith(2000, 0, 0.01);
      expect(filter.Q.setTargetAtTime).toHaveBeenLastCalledWith(1, 0, 0.01);
    });
    expect(feedbacks.ll.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.4, 0, 0.01);
  });

  it('normal: each line feeds itself, ping-pong: the mono sum bounces between the lines', () => {
    const { core, inputs, feedbacks } = setup();
    core.setParam('fb', 0.6);
    expect(gains(inputs)).toEqual({ l: 1, r: 1, x: 0 });
    expect(gains(feedbacks)).toEqual({ ll: 0.6, rr: 0.6, lr: 0, rl: 0 });

    core.setParam('mode', 1);
    expect(gains(inputs)).toEqual({ l: 0.5, r: 0, x: 0.5 });
    expect(gains(feedbacks)).toEqual({ ll: 0, rr: 0, lr: 0.6, rl: 0.6 });

    core.setParam('fb', 0.2);
    expect(gains(feedbacks)).toEqual({ ll: 0, rr: 0, lr: 0.2, rl: 0.2 });

    core.setParam('mode', 0);
    expect(gains(inputs)).toEqual({ l: 1, r: 1, x: 0 });
    expect(gains(feedbacks)).toEqual({ ll: 0.2, rr: 0.2, lr: 0, rl: 0 });
  });

  it('kills every feedback path while inactive, also after a mode change', () => {
    const { core, feedbacks } = setup();
    core.setActive(false);
    expect(gains(feedbacks)).toEqual({ ll: 0, rr: 0, lr: 0, rl: 0 });

    core.setParam('mode', 1);
    core.setParam('fb', 0.5);
    expect(gains(feedbacks)).toEqual({ ll: 0, rr: 0, lr: 0, rl: 0 });

    core.setActive(true);
    expect(gains(feedbacks)).toEqual({ ll: 0, rr: 0, lr: 0.5, rl: 0.5 });
  });

  it('time sets both lines, freq and q set both filters', () => {
    const { core, lines, filters } = setup();
    core.setParam('time', 0.45);
    core.setParam('freq', 3000);
    core.setParam('q', 2);
    lines.forEach((line) => expect(lastValue(line.delayTime)).toBe(0.45));
    filters.forEach((filter) => {
      expect(lastValue(filter.frequency)).toBe(3000);
      expect(lastValue(filter.Q)).toBe(2);
    });
  });

  it('sizes the lines for 1s and the offsets for the 50ms Haas range', () => {
    const { createDelay } = setup();
    expect(createDelay.mock.calls).toEqual([[1], [1], [0.05], [0.05]]);
  });

  it('pan delays the right channel when negative (echoes on the left) and the left one when positive', () => {
    const { core, offsets } = setup();
    core.setParam('pan', -0.02);
    expect(offsets.map((offset) => lastValue(offset.delayTime))).toEqual([0, 0.02]);
    core.setParam('pan', 0.025);
    expect(offsets.map((offset) => lastValue(offset.delayTime))).toEqual([0.025, 0]);
    core.setParam('pan', 0);
    expect(offsets.map((offset) => lastValue(offset.delayTime))).toEqual([0, 0]);
  });

  it('ignores unknown params', () => {
    const { core, lines } = setup();
    core.setParam('unknown', 1);
    lines.forEach((line) => expect(initialValue(line.delayTime)).toBe(0.2));
  });

  it('destroy disconnects every node', () => {
    const { core, input, splitter, merger, lines, filters, offsets, inputs, feedbacks } = setup();
    core.destroy();
    [
      input,
      splitter,
      merger,
      ...lines,
      ...filters,
      ...offsets,
      ...Object.values(inputs),
      ...Object.values(feedbacks),
    ].forEach((node) => expect(node.disconnect).toHaveBeenCalled());
  });

  describe('clear', () => {
    // the nodes made by clear: the delays and the bandpasses created after the first ones
    const cleared = (spy: jest.SpyInstance, from: number) =>
      spy.mock.results.slice(from).map(({ value }) => value);

    it('makes the lines, the bandpasses and the offsets again and wires them as the first ones', () => {
      const {
        core,
        createDelay,
        createBiquadFilter,
        splitter,
        merger,
        lines,
        filters,
        offsets,
        inputs,
        feedbacks,
      } = setup();
      core.clear?.();
      expect(createDelay.mock.calls.slice(4)).toEqual([[1], [1], [0.05], [0.05]]);
      const [lineL, lineR, offL, offR] = cleared(createDelay, 4) as DelayNode[];
      const [bpL, bpR] = cleared(createBiquadFilter, 2) as BiquadFilterNode[];
      [...lines, ...filters, ...offsets, ...Object.values(inputs), ...Object.values(feedbacks)].forEach(
        (node) => expect(node.disconnect).toHaveBeenCalled()
      );
      expect(splitter.disconnect).not.toHaveBeenCalled();
      expect(inputs.l.connect).toHaveBeenLastCalledWith(lineL);
      expect(inputs.x.connect).toHaveBeenLastCalledWith(lineL);
      expect(inputs.r.connect).toHaveBeenLastCalledWith(lineR);
      expect(lineL.connect).toHaveBeenCalledWith(bpL);
      expect(lineR.connect).toHaveBeenCalledWith(bpR);
      expect(bpL.connect).toHaveBeenCalledWith(feedbacks.ll);
      expect(bpL.connect).toHaveBeenCalledWith(feedbacks.lr);
      expect(bpR.connect).toHaveBeenCalledWith(feedbacks.rr);
      expect(bpR.connect).toHaveBeenCalledWith(feedbacks.rl);
      expect(feedbacks.ll.connect).toHaveBeenLastCalledWith(lineL);
      expect(feedbacks.rl.connect).toHaveBeenLastCalledWith(lineL);
      expect(feedbacks.rr.connect).toHaveBeenLastCalledWith(lineR);
      expect(feedbacks.lr.connect).toHaveBeenLastCalledWith(lineR);
      expect(offL.connect).toHaveBeenCalledWith(merger, 0, 0);
      expect(offR.connect).toHaveBeenCalledWith(merger, 0, 1);
      [bpL, bpR].forEach((filter) => expect(filter.type).toBe('bandpass'));
    });

    it('sets the new nodes at the knobs instantly (no chirp from their defaults), later changes glide', () => {
      const { core, createDelay, createBiquadFilter } = setup();
      core.setParam('time', 0.45);
      core.setParam('pan', -0.02);
      core.setParam('freq', 3000);
      core.setParam('q', 2);
      core.clear?.();
      const [lineL, lineR, offL, offR] = cleared(createDelay, 4) as DelayNode[];
      const filters = cleared(createBiquadFilter, 2) as BiquadFilterNode[];
      [lineL, lineR].forEach((line) => expect(initialValue(line.delayTime)).toBe(0.45));
      expect([offL, offR].map((offset) => initialValue(offset.delayTime))).toEqual([0, 0.02]);
      filters.forEach((filter) => {
        expect(initialValue(filter.frequency)).toBe(3000);
        expect(initialValue(filter.Q)).toBe(2);
      });
      core.setParam('time', 0.3);
      [lineL, lineR].forEach((line) => expect(lastValue(line.delayTime)).toBe(0.3));
    });

    it('keeps the gains: the feedback of the mode, killed while inactive', () => {
      const { core, feedbacks } = setup();
      core.setParam('fb', 0.6);
      core.setActive(false);
      const before = gains(feedbacks);
      core.clear?.();
      expect(gains(feedbacks)).toEqual(before);
    });

    it('destroy disconnects the new nodes', () => {
      const { core, createDelay } = setup();
      core.clear?.();
      core.destroy();
      cleared(createDelay, 4).forEach((node) => expect(node.disconnect).toHaveBeenCalled());
    });
  });

  it('formats pan by side', () => {
    const format = delay.params.pan.formatValue;
    expect(format?.(-0.012)).toBe('L 12ms');
    expect(format?.(0.05)).toBe('R 50ms');
    expect(format?.(0.0001)).toBe('0ms');
  });

  it('formats the frequency in Hz and kHz', () => {
    const format = delay.params.freq.formatValue;
    expect(format?.(440)).toBe('440Hz');
    expect(format?.(2500)).toBe('2.5kHz');
  });

  describe('modulation', () => {
    const ENV = { attack: 0.1, hold: 0, decay: 0.1, sustain: 0.5, release: 0.2 };
    const note = { envelopes: [ENV, ENV, ENV], start: 1, release: null };
    const route = (param: string, amount: number, min: number, max: number) => ({
      param,
      source: 1,
      amount,
      min,
      max,
    });
    // the delay with the lines of an fx-mod: the line, the knob and the params of each set
    const setupLines = () => {
      const fxMod = { set: jest.fn() };
      const audioCtx = new AudioContext();
      const createDelay = jest.spyOn(audioCtx, 'createDelay');
      const createBiquadFilter = jest.spyOn(audioCtx, 'createBiquadFilter');
      const core = delay.create(audioCtx, fxMod as unknown as FxMod);
      const results = <T>(spy: jest.SpyInstance) => spy.mock.results.map(({ value }) => value as T);
      const targets = (node: AudioNode) => (node.connect as jest.Mock).mock.calls.map(([target]) => target);
      const [lineL, lineR, offL, offR] = results<DelayNode>(createDelay);
      const [bpL, bpR] = results<BiquadFilterNode>(createBiquadFilter);
      const [fbLL, fbLR] = targets(bpL) as GainNode[];
      const [fbRR, fbRL] = targets(bpR) as GainNode[];
      const lineOf = (index: number) =>
        fxMod.set.mock.calls
          .filter(([line]) => line === index)
          .at(-1)
          ?.slice(1) as [unknown, AudioParam[]];
      return {
        core,
        fxMod,
        lineOf,
        createDelay,
        lines: [lineL, lineR],
        offsets: [offL, offR],
        filters: [bpL, bpR],
        feedbacks: { ll: fbLL, rr: fbRR, lr: fbLR, rl: fbRL },
      };
    };

    it('works the bandpass out once per block: its Freq and Q are k-rate', () => {
      const { filters } = setup();
      filters.forEach((filter) => {
        expect(filter.frequency.automationRate).toBe('k-rate');
        expect(filter.Q.automationRate).toBe('k-rate');
      });
    });

    it('a knob its routes move is a line of fx-mod on its params: Time on both lines, Freq and Q on both bandpasses', () => {
      const { core, lineOf, lines, filters } = setupLines();
      const time = route('time', 0.4, 0.01, 1);
      const freq = { ...route('freq', 2, 50, 17000), scale: 'log' as const };
      core.setModulation({ note, routes: [time, freq] });
      expect(lineOf(DELAY_LINES.time)).toEqual([
        { routes: [time], base: 0.2, map: 'linear' },
        [lines[0].delayTime, lines[1].delayTime],
      ]);
      expect(lineOf(DELAY_LINES.freq)).toEqual([
        { routes: [freq], base: 1000, map: 'linear' },
        [filters[0].frequency, filters[1].frequency],
      ]);
      // the others have none
      expect(lineOf(DELAY_LINES.q)?.[0]).toBeNull();
    });

    it('moves the feedback on the gains of the mode while it is active, the pan on the delay of each side', () => {
      const { core, lineOf, feedbacks, offsets } = setupLines();
      const fb = route('fb', 0.3, 0, 0.9);
      const pan = route('pan', 0.05, -0.05, 0.05);
      core.setModulation({ note, routes: [fb, pan] });
      expect(lineOf(DELAY_LINES.fb)).toEqual([
        { routes: [fb], base: 0.5, map: 'linear' },
        [feedbacks.ll.gain, feedbacks.rr.gain],
      ]);
      expect(lineOf(DELAY_LINES.fbX)).toEqual([null, []]);
      expect(lineOf(DELAY_LINES.panL)).toEqual([
        { routes: [pan], base: 0, map: 'panL' },
        [offsets[0].delayTime],
      ]);
      expect(lineOf(DELAY_LINES.panR)).toEqual([
        { routes: [pan], base: 0, map: 'panR' },
        [offsets[1].delayTime],
      ]);
      // ping-pong: the line of the gains between the lines comes in, the other one goes (its offset glides to 0 on
      // the gains it was on: fx-mod disconnects them after)
      core.setParam('mode', 1);
      expect(lineOf(DELAY_LINES.fb)).toEqual([null, []]);
      expect(lineOf(DELAY_LINES.fbX)).toEqual([
        { routes: [fb], base: 0.5, map: 'linear' },
        [feedbacks.lr.gain, feedbacks.rl.gain],
      ]);
      // inactive: no feedback, the lines drain
      core.setActive(false);
      expect(lineOf(DELAY_LINES.fb)).toEqual([null, []]);
      expect(lineOf(DELAY_LINES.fbX)).toEqual([null, []]);
    });

    it('a knob turned gives its line its value, routes gone none; the knob glides as ever (Time with its tape glide)', () => {
      const { core, lineOf, lines } = setupLines();
      const time = route('time', 0.4, 0.01, 1);
      core.setModulation({ note, routes: [time] });
      core.setParam('time', 0.5);
      expect(lineOf(DELAY_LINES.time)?.[0]).toEqual({ routes: [time], base: 0.5, map: 'linear' });
      expect((lines[0].delayTime.setTargetAtTime as jest.Mock).mock.lastCall).toEqual([0.5, 0, 0.1]);
      core.setModulation(null);
      expect(lineOf(DELAY_LINES.time)).toEqual([null, [lines[0].delayTime, lines[1].delayTime]]);
    });

    it('clear puts the lines on the params of the new nodes', () => {
      const { core, lineOf, createDelay } = setupLines();
      core.setModulation({ note, routes: [route('time', 0.4, 0.01, 1)] });
      core.clear?.();
      const [l, r] = createDelay.mock.results.slice(4, 6).map(({ value }) => value as DelayNode);
      expect(lineOf(DELAY_LINES.time)?.[1]).toEqual([l.delayTime, r.delayTime]);
    });
  });
});
