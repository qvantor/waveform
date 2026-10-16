import { BehaviorSubject } from 'rxjs';
import { createFxSlot } from './create-fx-slot';
import { FxCore, FxStatus } from './types';

const createCore = (audioCtx: AudioContext, latency?: number): FxCore => ({
  input: audioCtx.createGain(),
  output: audioCtx.createGain(),
  setParam: jest.fn(),
  setActive: jest.fn(),
  destroy: jest.fn(),
  latency,
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
