import { BehaviorSubject } from 'rxjs';
import { createFxSlot, FxSlot, mixGains } from './create-fx-slot';
import { FxCore, FxStatus } from './types';

const createCore = (audioCtx: AudioContext, latency?: number): FxCore => ({
  input: audioCtx.createGain(),
  output: audioCtx.createGain(),
  setParam: jest.fn(),
  setActive: jest.fn(),
  destroy: jest.fn(),
  latency,
});

describe('mixGains', () => {
  it('equal power by default: only dry at 0, both at -3 dB in the middle, the power stays 1', () => {
    expect(mixGains(0)).toEqual([1, 0]);
    mixGains(0.5).forEach((gain) => expect(gain).toBeCloseTo(Math.SQRT1_2, 12));
    [0.1, 0.3, 0.7, 1].forEach((mix) => {
      const [dry, wet] = mixGains(mix);
      expect(dry * dry + wet * wet).toBeCloseTo(1, 12);
    });
  });

  it('linear: the gains add up to 1, both at -6 dB in the middle', () => {
    expect(mixGains(0, true)).toEqual([1, 0]);
    expect(mixGains(0.25, true)).toEqual([0.75, 0.25]);
    expect(mixGains(0.5, true)).toEqual([0.5, 0.5]);
    expect(mixGains(1, true)).toEqual([0, 1]);
  });
});

describe('createFxSlot', () => {
  it('passes the input straight to dry and the send into the core', () => {
    const audioCtx = new AudioContext();
    const core = createCore(audioCtx);
    const slot = createFxSlot(audioCtx, core);
    expect(slot.dryDelay).toBeUndefined();
    expect(slot.input.connect).toHaveBeenCalledWith(slot.dry);
    expect(slot.input.connect).toHaveBeenCalledWith(slot.send);
    expect(slot.send.connect).toHaveBeenCalledWith(core.input);
    expect(core.output.connect).toHaveBeenCalledWith(slot.wet);
    expect(slot.dry.connect).toHaveBeenCalledWith(slot.output);
    expect(slot.wet.connect).toHaveBeenCalledWith(slot.output);
  });

  it('delays the dry signal by the latency of the core, so dry and wet stay aligned', () => {
    const audioCtx = new AudioContext();
    const createDelay = jest.spyOn(audioCtx, 'createDelay');
    const latency = 32 / audioCtx.sampleRate;
    const slot = createFxSlot(audioCtx, createCore(audioCtx, latency));
    expect(createDelay).toHaveBeenCalledWith(latency);
    const dryDelay = slot.dryDelay as DelayNode;
    expect(dryDelay).toBe(createDelay.mock.results[0].value);
    expect(dryDelay.delayTime.setValueAtTime).toHaveBeenCalledWith(latency, audioCtx.currentTime);
    expect(slot.input.connect).toHaveBeenCalledWith(dryDelay);
    expect(slot.input.connect).not.toHaveBeenCalledWith(slot.dry);
    expect(dryDelay.connect).toHaveBeenCalledWith(slot.dry);
  });

  it('no latency or a zero one: no delay', () => {
    const audioCtx = new AudioContext();
    const createDelay = jest.spyOn(audioCtx, 'createDelay');
    createFxSlot(audioCtx, createCore(audioCtx, 0));
    createFxSlot(audioCtx, createCore(audioCtx));
    expect(createDelay).not.toHaveBeenCalled();
  });

  it('mixes linearly when the core asks for it, at equal power otherwise; bypassed only the dry signal', () => {
    const audioCtx = new AudioContext();
    const gains = (slot: FxSlot) =>
      [slot.dry, slot.wet].map((node) => (node.gain.setTargetAtTime as jest.Mock).mock.lastCall?.[0]);
    const linear = createFxSlot(audioCtx, { ...createCore(audioCtx), linearMix: true });
    linear.setMix(0.25, true);
    expect(gains(linear)).toEqual([0.75, 0.25]);
    linear.setMix(0.25, false);
    expect(gains(linear)).toEqual([1, 0]);
    const equalPower = createFxSlot(audioCtx, createCore(audioCtx));
    equalPower.setMix(0.5, true);
    gains(equalPower).forEach((gain) => expect(gain).toBeCloseTo(Math.SQRT1_2, 12));
  });

  it('a core without a status is ready, its retry does nothing', () => {
    const audioCtx = new AudioContext();
    const slot = createFxSlot(audioCtx, createCore(audioCtx));
    expect(slot.$status.value).toBe('ready');
    expect(() => slot.retry()).not.toThrow();
  });

  it('passes the status and the retry of the core', () => {
    const audioCtx = new AudioContext();
    const $status = new BehaviorSubject<FxStatus>('loading');
    const retry = jest.fn();
    const slot = createFxSlot(audioCtx, { ...createCore(audioCtx), $status, retry });
    expect(slot.$status).toBe($status);
    slot.retry();
    expect(retry).toHaveBeenCalled();
  });

  it('destroy destroys the core and disconnects every node, the dry delay too', () => {
    const audioCtx = new AudioContext();
    const core = createCore(audioCtx, 0.001);
    const slot = createFxSlot(audioCtx, core);
    slot.destroy();
    expect(core.destroy).toHaveBeenCalled();
    [slot.input, slot.output, slot.dry, slot.dryDelay, slot.wet, slot.send, slot.drain].forEach((node) =>
      expect(node?.disconnect).toHaveBeenCalled()
    );
  });
});
