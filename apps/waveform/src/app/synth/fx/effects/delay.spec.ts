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

const lastValue = (param: AudioParam) => (param.setTargetAtTime as jest.Mock).mock.lastCall?.[0];
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

  it('applies the defaults on create', () => {
    const { lines, filters, offsets, inputs, feedbacks } = setup();
    lines.forEach((line) => expect(lastValue(line.delayTime)).toBe(0.2));
    offsets.forEach((offset) => expect(lastValue(offset.delayTime)).toBe(0));
    filters.forEach((filter) => {
      expect(lastValue(filter.frequency)).toBe(1000);
      expect(lastValue(filter.Q)).toBe(0.01);
    });
    expect(gains(inputs)).toEqual({ l: 1, r: 1, x: 0 });
    expect(gains(feedbacks)).toEqual({ ll: 0.5, rr: 0.5, lr: 0, rl: 0 });
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

  it('pan delays the left channel when negative and the right one when positive', () => {
    const { core, offsets } = setup();
    core.setParam('pan', -0.02);
    expect(offsets.map((offset) => lastValue(offset.delayTime))).toEqual([0.02, 0]);
    core.setParam('pan', 0.025);
    expect(offsets.map((offset) => lastValue(offset.delayTime))).toEqual([0, 0.025]);
    core.setParam('pan', 0);
    expect(offsets.map((offset) => lastValue(offset.delayTime))).toEqual([0, 0]);
  });

  it('ignores unknown params', () => {
    const { core, lines } = setup();
    core.setParam('unknown', 1);
    lines.forEach((line) => expect(lastValue(line.delayTime)).toBe(0.2));
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
});
