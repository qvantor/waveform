import { delay } from './delay';

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
    const calls = (param: AudioParam, method: keyof AudioParam) => (param[method] as jest.Mock).mock.calls;
    const route = (param: string, amount: number, min: number, max: number, log = false) => ({
      param,
      env: 1,
      amount,
      min,
      max,
      ...(log && { log }),
    });

    it('automates the time of both lines directly: ramps of base + amount × level', () => {
      const { core, lines } = setup();
      core.setModulation({ note, routes: [route('time', 0.4, 0.01, 1)] });
      // after the glide into it
      lines.forEach((line) =>
        expect(calls(line.delayTime, 'linearRampToValueAtTime')[1]).toEqual([
          expect.closeTo(0.6, 9),
          expect.closeTo(1.1, 9),
        ])
      );
    });

    it('works the bandpass out once per block: its Freq and Q are k-rate', () => {
      const { filters } = setup();
      filters.forEach((filter) => {
        expect(filter.frequency.automationRate).toBe('k-rate');
        expect(filter.Q.automationRate).toBe('k-rate');
      });
    });

    it('ramps the frequency and the Q of the bandpass exponentially', () => {
      const { core, filters } = setup();
      core.setModulation({
        note,
        routes: [route('freq', 2, 50, 17000, true), route('q', -1, 0.01, 3, true)],
      });
      filters.forEach((filter) => {
        expect(calls(filter.frequency, 'exponentialRampToValueAtTime')[0]).toEqual([
          expect.closeTo(4000, 6),
          expect.closeTo(1.1, 9),
        ]);
        expect(calls(filter.Q, 'setValueAtTime').length).toBeGreaterThan(1);
      });
    });

    it('moves the feedback on the gains of the mode, the pan on the delay of its side', () => {
      const { core, feedbacks, offsets } = setup();
      core.setParam('mode', 1);
      core.setModulation({ note, routes: [route('fb', 0.4, 0, 0.9), route('pan', 0.04, -0.05, 0.05)] });
      // ping-pong: the lines feed each other
      [feedbacks.lr, feedbacks.rl].forEach((node) =>
        expect(calls(node.gain, 'linearRampToValueAtTime')[1]).toEqual([
          expect.closeTo(0.9, 9),
          expect.closeTo(1.1, 9),
        ])
      );
      [feedbacks.ll, feedbacks.rr].forEach((node) =>
        expect(calls(node.gain, 'linearRampToValueAtTime')).toEqual([])
      );
      // from 0 the pan moves right: the left channel is delayed
      expect(calls(offsets[0].delayTime, 'linearRampToValueAtTime')[15]).toEqual([
        expect.closeTo(0.04, 9),
        expect.closeTo(1.1, 9),
      ]);
      const right = calls(offsets[1].delayTime, 'linearRampToValueAtTime');
      expect(right.length).toBeGreaterThan(0);
      expect(Math.max(...right.map(([value]) => value))).toBe(0);
    });

    // the order of the last call of a method of a param (-Infinity: none)
    const lastOrder = (param: AudioParam, method: keyof AudioParam) =>
      Math.max(-Infinity, ...(param[method] as jest.Mock).mock.invocationCallOrder);
    // the order of its last hold: its automation left where it is (an automation of its own at a point of its
    // line, then what follows cancelled; any other by cancelAndHoldAtTime)
    const lastHold = (param: AudioParam) =>
      Math.max(lastOrder(param, 'cancelScheduledValues'), lastOrder(param, 'cancelAndHoldAtTime'));
    const holds = (param: AudioParam) =>
      calls(param, 'cancelScheduledValues').length + calls(param, 'cancelAndHoldAtTime').length;

    it('a mode change leaves the automation of the feedback gains of the old mode: one loop feeds back', () => {
      const { core, feedbacks } = setup();
      core.setModulation({ note, routes: [route('fb', 0.4, 0, 0.9)] });
      expect(calls(feedbacks.ll.gain, 'linearRampToValueAtTime').length).toBeGreaterThan(0);
      core.setParam('mode', 1);
      // normal → ping-pong: the lines no longer feed themselves, from where they are to 0
      [feedbacks.ll, feedbacks.rr].forEach(({ gain }) => {
        expect(lastHold(gain)).toBeGreaterThan(lastOrder(gain, 'linearRampToValueAtTime'));
        expect(lastValue(gain)).toBe(0);
      });
      // they feed each other, moved by the envelope
      [feedbacks.lr, feedbacks.rl].forEach(({ gain }) =>
        expect(calls(gain, 'linearRampToValueAtTime')[1]).toEqual([
          expect.closeTo(0.9, 9),
          expect.closeTo(1.1, 9),
        ])
      );
    });

    it('does not move the feedback while inactive: the lines drain', () => {
      const { core, feedbacks } = setup();
      core.setModulation({ note, routes: [route('fb', 0.4, 0, 0.9)] });
      core.setActive(false);
      core.setModulation({ note: { ...note, start: 2 }, routes: [route('fb', 0.4, 0, 0.9)] });
      Object.values(feedbacks).forEach(({ gain }) => {
        expect(lastOrder(gain, 'setTargetAtTime')).toBeGreaterThan(
          lastOrder(gain, 'linearRampToValueAtTime')
        );
        expect(lastValue(gain)).toBe(0);
      });
      [feedbacks.ll, feedbacks.rr].forEach(({ gain }) =>
        expect(lastHold(gain)).toBeGreaterThan(lastOrder(gain, 'linearRampToValueAtTime'))
      );
      // active again: moved on the gains of the mode
      core.setActive(true);
      expect(calls(feedbacks.ll.gain, 'linearRampToValueAtTime').at(-2)).toEqual([
        expect.closeTo(0.9, 9),
        expect.closeTo(2.1, 9),
      ]);
    });

    it('builds the automation again when a knob turns, lets a knob go back to its value without its routes', () => {
      const { core, lines } = setup();
      core.setModulation({ note, routes: [route('time', 0.4, 0.01, 1)] });
      core.setParam('time', 0.3);
      expect(calls(lines[0].delayTime, 'linearRampToValueAtTime').at(-2)).toEqual([
        expect.closeTo(0.7, 9),
        expect.closeTo(1.1, 9),
      ]);
      core.setModulation(null);
      // held for the note, the knob turned and the routes gone
      expect(holds(lines[0].delayTime)).toBe(3);
      expect(lastValue(lines[0].delayTime)).toBe(0.3);
    });
  });
});
