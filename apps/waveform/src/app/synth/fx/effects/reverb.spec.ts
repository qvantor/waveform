import { DIFFUSER_TIMES, ER_TAPS, DIFFUSION, MOD_DEPTH, MOD_RATES, reverb, TAIL_LEVEL } from './reverb';
import { LINE_TIMES, lineDecay, sizeFactor, XOVER } from './reverb-decay';
import { BODY_FREQ, BODY_Q, REVERB_ERAS, tubeCurve, TUBE_RANGE } from './reverb-era';

// the nodes are found through the graph: the mocked createDelay also creates a gain for delayTime
const setup = () => {
  const audioCtx = new AudioContext();
  const createDelay = jest.spyOn(audioCtx, 'createDelay');
  const createBiquadFilter = jest.spyOn(audioCtx, 'createBiquadFilter');
  const createOscillator = jest.spyOn(audioCtx, 'createOscillator');
  const createChannelSplitter = jest.spyOn(audioCtx, 'createChannelSplitter');
  const createChannelMerger = jest.spyOn(audioCtx, 'createChannelMerger');
  const createWaveShaper = jest.spyOn(audioCtx, 'createWaveShaper');
  const core = reverb.create(audioCtx);

  const results = <T>(spy: jest.SpyInstance) => spy.mock.results.map(({ value }) => value as T);
  const delays = results<DelayNode>(createDelay);
  const filters = results<BiquadFilterNode>(createBiquadFilter);
  const lfos = results<OscillatorNode>(createOscillator);
  const [splitter] = results<ChannelSplitterNode>(createChannelSplitter);
  const [merger] = results<ChannelMergerNode>(createChannelMerger);
  const [tube] = results<WaveShaperNode>(createWaveShaper);

  // filters: lowcut, 2 bandwidth lowpasses, body, ER absorption, then lowshelf and highshelf of every line
  const [lowcut, ...bandwidth] = filters.slice(0, 3);
  const body = filters[3];
  const firstLineFilter = 5;
  // predelay, 8 ER taps, 4 diffusers, 8 lines
  const [predelay] = delays;
  const [erIn, firstDiffuser] = targets(predelay) as GainNode[];
  const [erAbsorb] = targets(erIn) as BiquadFilterNode[];
  const taps = (targets(erAbsorb) as DelayNode[]).map((delay) => {
    const [level] = targets(delay) as GainNode[];
    return { delay, level, side: targets(level)[0] as GainNode };
  });
  const diffusers = delays
    .slice(1 + ER_TAPS.length, 1 + ER_TAPS.length + DIFFUSER_TIMES.length)
    .map((delay) => {
      const [fb, out] = targets(delay) as GainNode[];
      const sum = targets(fb)[0] as GainNode;
      return { sum, delay, fb, ff: targets(sum)[1] as GainNode, out };
    });
  const splits = (splitter.connect as jest.Mock).mock.calls;
  const lines = delays.slice(1 + ER_TAPS.length + DIFFUSER_TIMES.length).map((delay, i) => {
    const low = filters[firstLineFilter + i * 2];
    const high = filters[firstLineFilter + 1 + i * 2];
    const [fb] = targets(high) as GainNode[];
    const [sum, bus] = targets(fb) as GainNode[];
    const [, tailLevel] = targets(delay) as GainNode[];
    return { in: splits[i][0] as GainNode, channel: splits[i][1], sum, bus, delay, low, high, fb, tailLevel };
  });
  const mods = lfos.flatMap((lfo) => targets(lfo) as GainNode[]);
  const [erL, erR] = [taps[0].side, taps[1].side];
  const sideL = targets(erL)[0] as GainNode;
  const sideR = targets(erR)[0] as GainNode;
  const [ll, lr] = targets(sideL) as GainNode[];
  const [rr, rl] = targets(sideR) as GainNode[];

  return {
    audioCtx,
    core,
    input: core.input as GainNode,
    tube,
    lowcut,
    bandwidth,
    body,
    predelay,
    erIn,
    erAbsorb,
    firstDiffuser,
    taps,
    erLevels: { l: erL, r: erR },
    diffusers,
    splitter,
    lines,
    lfos,
    mods,
    sides: { l: sideL, r: sideR },
    widths: { ll, rr, lr, rl },
    merger,
  };
};

const targets = (node: AudioNode) => (node.connect as jest.Mock).mock.calls.map(([target]) => target);

// changes after create are smoothed, the initial values are set instantly
const lastValue = (param: AudioParam) => (param.setTargetAtTime as jest.Mock).mock.lastCall?.[0];
const lastTimeConstant = (param: AudioParam) => (param.setTargetAtTime as jest.Mock).mock.lastCall?.[2];
const initialValue = (param: AudioParam) => {
  expect(param.setTargetAtTime).not.toHaveBeenCalled();
  return (param.setValueAtTime as jest.Mock).mock.lastCall?.[0];
};

const DEFAULT_FACTOR = sizeFactor(0.5);

describe('reverb', () => {
  it('upmixes the input to stereo, colors it, cuts the lows and delays it, outputs the merger', () => {
    const { core, input, tube, lowcut, bandwidth, body, predelay, merger } = setup();
    expect(core.output).toBe(merger);
    expect(input).toMatchObject({
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
    // the tube gets the band-limited signal, the highpass right after it removes the DC of its asymmetric curve
    expect(input.connect).toHaveBeenCalledWith(bandwidth[0]);
    expect(bandwidth[0].connect).toHaveBeenCalledWith(bandwidth[1]);
    expect(bandwidth[1].connect).toHaveBeenCalledWith(tube);
    expect(tube.connect).toHaveBeenCalledWith(lowcut);
    expect(lowcut.connect).toHaveBeenCalledWith(body);
    expect(body.connect).toHaveBeenCalledWith(predelay);
    expect(lowcut.type).toBe('highpass');
    expect(initialValue(lowcut.frequency)).toBe(20);
    expect(initialValue(lowcut.Q)).toBeCloseTo(-3.01);
    expect(initialValue(predelay.delayTime)).toBe(0.02);
  });

  it('scales the input to the tube curve range and oversamples the tube', () => {
    const { input, tube } = setup();
    expect(initialValue(input.gain)).toBe(1 / TUBE_RANGE);
    expect(tube.oversample).toBe('4x');
  });

  it('starts in the 80s: no tube drive, 10 kHz bandwidth and a little body, set instantly', () => {
    const { tube, bandwidth, body } = setup();
    expect(tube.curve).toEqual(tubeCurve(0));
    bandwidth.forEach((node) => {
      expect(node.type).toBe('lowpass');
      expect(initialValue(node.frequency)).toBe(10000);
      expect(initialValue(node.Q)).toBeCloseTo(-3.01);
    });
    expect(body.type).toBe('peaking');
    expect(initialValue(body.frequency)).toBe(BODY_FREQ);
    expect(initialValue(body.Q)).toBe(BODY_Q);
    expect(initialValue(body.gain)).toBe(1);
  });

  it('era switches the tube curve, the bandwidth and the body smoothly', () => {
    const { audioCtx, core, tube, bandwidth, body } = setup();
    core.setParam('era', 2);
    expect(tube.curve).toEqual(tubeCurve(REVERB_ERAS[2].drive));
    expect(REVERB_ERAS[2].drive).toBeGreaterThan(0);
    bandwidth.forEach((node) => expect(lastValue(node.frequency)).toBe(6500));
    expect(lastValue(body.gain)).toBe(2);

    // now: a straight curve and the lowpasses at nyquist pass the input unchanged
    core.setParam('era', 0);
    expect(tube.curve).toEqual(tubeCurve(0));
    bandwidth.forEach((node) => expect(lastValue(node.frequency)).toBe(audioCtx.sampleRate / 2));
    expect(lastValue(body.gain)).toBe(0);
  });

  it.each([
    [-1, 0],
    [1.4, 1],
    [5, 2],
  ])('era %p is clamped and rounded to %p', (value, index) => {
    const { core, tube } = setup();
    core.setParam('era', value);
    expect(tube.curve).toEqual(tubeCurve(REVERB_ERAS[index].drive));
  });

  it('taps the early reflections from the absorbed mono sum, even taps left, odd ones right', () => {
    const { erIn, erAbsorb, taps, erLevels } = setup();
    expect(erIn).toMatchObject({ channelCount: 1, channelCountMode: 'explicit' });
    expect(erAbsorb.type).toBe('lowpass');
    expect(initialValue(erAbsorb.frequency)).toBe(6000);
    expect(initialValue(erAbsorb.Q)).toBeCloseTo(-3.01);
    expect(taps).toHaveLength(ER_TAPS.length);
    taps.forEach(({ delay, level, side }, i) => {
      expect(initialValue(delay.delayTime)).toBeCloseTo(ER_TAPS[i][0] * DEFAULT_FACTOR);
      expect(initialValue(level.gain)).toBe(ER_TAPS[i][1]);
      expect(side).toBe(i % 2 ? erLevels.r : erLevels.l);
    });
    expect(initialValue(erLevels.l.gain)).toBe(0.5);
  });

  it('chains the allpass diffusers into the splitter', () => {
    const { firstDiffuser, diffusers, splitter } = setup();
    expect(diffusers[0].sum).toBe(firstDiffuser);
    diffusers.forEach(({ sum, delay, fb, ff, out }, i) => {
      expect(sum.connect).toHaveBeenCalledWith(delay);
      expect(fb.connect).toHaveBeenCalledWith(sum);
      expect(ff.connect).toHaveBeenCalledWith(out);
      expect(out.connect).toHaveBeenCalledWith(i < diffusers.length - 1 ? diffusers[i + 1].sum : splitter);
      expect(initialValue(delay.delayTime)).toBe(DIFFUSER_TIMES[i]);
      expect(initialValue(fb.gain)).toBe(DIFFUSION);
      expect(initialValue(ff.gain)).toBe(-DIFFUSION);
    });
  });

  it('feeds the lines from both channels with alternating signs', () => {
    const { lines } = setup();
    expect(lines).toHaveLength(LINE_TIMES.length);
    expect(lines.map(({ channel }) => channel)).toEqual([0, 1, 0, 1, 0, 1, 0, 1]);
    expect(lines.map((line) => initialValue(line.in.gain))).toEqual([
      0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5,
    ]);
    lines.forEach((line) => expect(line.in.connect).toHaveBeenCalledWith(line.sum));
  });

  it('mixes the feedback with a Householder matrix (I - 2/N)', () => {
    const { lines } = setup();
    const [{ bus }] = lines;
    expect(initialValue(bus.gain)).toBe(-2 / lines.length);
    lines.forEach((line) => {
      expect(line.bus).toBe(bus);
      expect(line.sum.connect).toHaveBeenCalledWith(line.delay);
      expect(line.delay.connect).toHaveBeenCalledWith(line.low);
      expect(line.low.connect).toHaveBeenCalledWith(line.high);
      expect(line.fb.connect).toHaveBeenCalledWith(line.sum);
      expect(bus.connect).toHaveBeenCalledWith(line.sum);
      expect(line.low.type).toBe('lowshelf');
      expect(line.high.type).toBe('highshelf');
    });
  });

  it('sets the decay of every line instantly on create', () => {
    const { lines } = setup();
    lines.forEach((line, i) => {
      const length = LINE_TIMES[i] * DEFAULT_FACTOR;
      const expected = lineDecay(length, 2, 1);
      expect(initialValue(line.delay.delayTime)).toBeCloseTo(length);
      expect(initialValue(line.fb.gain)).toBeCloseTo(expected.gain);
      expect(initialValue(line.low.gain)).toBe(0);
      expect(initialValue(line.high.gain)).toBeCloseTo(expected.highDb);
      expect(initialValue(line.low.frequency)).toBe(XOVER);
      expect(initialValue(line.high.frequency)).toBe(6000);
    });
  });

  it('decay, bass and size recompute the feedback and the shelves smoothly', () => {
    const { core, lines } = setup();
    core.setParam('decay', 10);
    core.setParam('bass', 2);
    const decay = (i: number, factor = DEFAULT_FACTOR) => lineDecay(LINE_TIMES[i] * factor, 10, 2);
    lines.forEach((line, i) => {
      expect(lastValue(line.fb.gain)).toBeCloseTo(decay(i).gain);
      expect(lastValue(line.low.gain)).toBeCloseTo(decay(i).lowDb);
      expect(lastValue(line.low.gain)).toBeGreaterThan(0);
    });

    core.setParam('size', 1);
    lines.forEach((line, i) => {
      expect(lastValue(line.delay.delayTime)).toBeCloseTo(LINE_TIMES[i] * sizeFactor(1));
      // tape-like glide
      expect(lastTimeConstant(line.delay.delayTime)).toBe(0.1);
      expect(lastValue(line.fb.gain)).toBeCloseTo(decay(i, sizeFactor(1)).gain);
    });
  });

  it('size scales the early reflections too', () => {
    const { core, taps } = setup();
    core.setParam('size', 0);
    taps.forEach(({ delay }, i) =>
      expect(lastValue(delay.delayTime)).toBeCloseTo(ER_TAPS[i][0] * sizeFactor(0))
    );
  });

  it('applies the low cut, predelay and hi damp, the reflections are damped too', () => {
    const { core, lowcut, predelay, lines, erAbsorb } = setup();
    core.setParam('lowcut', 200);
    core.setParam('pre', 0);
    core.setParam('damp', 3000);
    expect(lastValue(lowcut.frequency)).toBe(200);
    expect(lastValue(predelay.delayTime)).toBe(0);
    lines.forEach((line) => expect(lastValue(line.high.frequency)).toBe(3000));
    expect(lastValue(erAbsorb.frequency)).toBe(3000);
  });

  // diffusion, crossover, mod speed and high cut are fixed, old presets may still carry them
  it.each(['diff', 'xover', 'speed', 'highcut'])('ignores the removed param %s', (key) => {
    const { core, lines, lfos, diffusers } = setup();
    core.setParam(key, 1);
    [
      ...lines.flatMap((line) => [line.low.frequency, line.high.frequency, line.fb.gain]),
      ...lfos.map((lfo) => lfo.frequency),
      ...diffusers.flatMap(({ fb, ff }) => [fb.gain, ff.gain]),
    ].forEach((param) => expect(param.setTargetAtTime).not.toHaveBeenCalled());
  });

  it('modulates every line length with its own lfo at a fixed rate', () => {
    const { core, lfos, mods, lines } = setup();
    expect(lfos).toHaveLength(lines.length);
    lfos.forEach((lfo) => expect(lfo.start).toHaveBeenCalled());
    expect(lfos.map((lfo) => initialValue(lfo.frequency))).toEqual(MOD_RATES);
    expect(new Set(MOD_RATES).size).toBe(lines.length);
    expect(mods).toHaveLength(lines.length);
    mods.forEach((mod, i) => expect(mod.connect).toHaveBeenCalledWith(lines[i].delay.delayTime));

    core.setParam('depth', 1);
    expect(mods.map((mod) => Math.abs(lastValue(mod.gain)))).toEqual(mods.map(() => MOD_DEPTH));
    core.setParam('depth', 0);
    mods.forEach((mod) => expect(lastValue(mod.gain) === 0).toBe(true));
  });

  it('sums the lines by channel at a fixed tail level, ER sets the reflections against it', () => {
    const { core, lines, erLevels, sides } = setup();
    lines.forEach((line, i) => expect(line.tailLevel).toBe(lines[i % 2].tailLevel));
    expect(lines[0].tailLevel).not.toBe(lines[1].tailLevel);
    expect(lines[0].tailLevel.connect).toHaveBeenCalledWith(sides.l);
    expect(lines[1].tailLevel.connect).toHaveBeenCalledWith(sides.r);
    expect(initialValue(lines[0].tailLevel.gain)).toBe(TAIL_LEVEL);
    expect(initialValue(lines[1].tailLevel.gain)).toBe(TAIL_LEVEL);

    // the wet level is the common mix: no tail param
    core.setParam('tail', 0);
    core.setParam('er', 1);
    expect(lines[0].tailLevel.gain.setTargetAtTime).not.toHaveBeenCalled();
    expect(lastValue(erLevels.l.gain)).toBe(1);
    expect(lastValue(erLevels.r.gain)).toBe(1);
  });

  it('sets the stereo width with a mid/side matrix', () => {
    const { core, widths, merger } = setup();
    expect(widths.ll.connect).toHaveBeenCalledWith(merger, 0, 0);
    expect(widths.rl.connect).toHaveBeenCalledWith(merger, 0, 0);
    expect(widths.rr.connect).toHaveBeenCalledWith(merger, 0, 1);
    expect(widths.lr.connect).toHaveBeenCalledWith(merger, 0, 1);
    expect([initialValue(widths.ll.gain), initialValue(widths.lr.gain)]).toEqual([1, 0]);

    const gains = () => [widths.ll, widths.rr, widths.lr, widths.rl].map((node) => lastValue(node.gain));
    core.setParam('sep', 0);
    expect(gains()).toEqual([0.5, 0.5, 0.5, 0.5]);
    core.setParam('sep', 2);
    expect(gains()).toEqual([1.5, 1.5, -0.5, -0.5]);
  });

  it('kills the feedback while inactive and restores it', () => {
    const { core, lines } = setup();
    core.setActive(false);
    lines.forEach((line) => expect(lastValue(line.fb.gain)).toBe(0));
    core.setParam('decay', 5);
    lines.forEach((line) => expect(lastValue(line.fb.gain)).toBe(0));
    core.setActive(true);
    lines.forEach((line, i) =>
      expect(lastValue(line.fb.gain)).toBeCloseTo(lineDecay(LINE_TIMES[i] * DEFAULT_FACTOR, 5, 1).gain)
    );
  });

  it('ignores unknown params', () => {
    const { core, lines } = setup();
    core.setParam('time', 1);
    lines.forEach((line) => expect(line.fb.gain.setTargetAtTime).not.toHaveBeenCalled());
  });

  it('destroy stops the lfos and disconnects the nodes', () => {
    const { core, lfos, lines, merger, input, tube, bandwidth, body, erAbsorb } = setup();
    core.destroy();
    lfos.forEach((lfo) => {
      expect(lfo.stop).toHaveBeenCalled();
      expect(lfo.disconnect).toHaveBeenCalled();
    });
    [
      input,
      tube,
      ...bandwidth,
      body,
      erAbsorb,
      merger,
      ...lines.flatMap((line) => [line.delay, line.fb, line.sum, line.low]),
    ].forEach((node) => expect(node.disconnect).toHaveBeenCalled());
  });
});
