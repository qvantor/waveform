import { BehaviorSubject } from 'rxjs';
import { createFxSlot, FxSlot, mixGains } from './create-fx-slot';
import { FxCore, FxStatus } from './types';
import type { FxMod } from './fx-mod';

const createCore = (audioCtx: AudioContext, latency?: number): FxCore => ({
  input: audioCtx.createGain(),
  output: audioCtx.createGain(),
  setParam: jest.fn(),
  setActive: jest.fn(),
  setModulation: jest.fn(),
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

  it('clear empties the core, a core without a tail has nothing to clear', () => {
    const audioCtx = new AudioContext();
    const clear = jest.fn();
    createFxSlot(audioCtx, { ...createCore(audioCtx), clear }).clear();
    expect(clear).toHaveBeenCalledTimes(1);
    expect(() => createFxSlot(audioCtx, createCore(audioCtx)).clear()).not.toThrow();
  });

  it('clear sets the gains at the knobs at once, they glided there', () => {
    const audioCtx = new AudioContext();
    const slot = createFxSlot(audioCtx, createCore(audioCtx));
    const last = (node: GainNode) => (node.gain.setValueAtTime as jest.Mock).mock.lastCall;
    slot.setMix(0.5, true);
    slot.setActive(true);
    slot.clear();
    expect(last(slot.send)).toEqual([1, 0]);
    expect(last(slot.dry)).toEqual([expect.closeTo(Math.SQRT1_2, 12), 0]);
    expect(last(slot.wet)).toEqual([expect.closeTo(Math.SQRT1_2, 12), 0]);
    [slot.send, slot.dry, slot.wet].forEach((node) =>
      expect(node.gain.cancelScheduledValues).toHaveBeenLastCalledWith(0)
    );
    // bypassed and inactive: only dry, the send closed
    slot.setMix(0.5, false);
    slot.setActive(false);
    slot.clear();
    expect([slot.send, slot.dry, slot.wet].map((node) => last(node)?.[0])).toEqual([0, 1, 0]);
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

  describe('modulation', () => {
    const ENV = { attack: 0.1, hold: 0, decay: 0.1, sustain: 0.5, release: 0.2 };
    const note = { envelopes: [ENV, ENV, ENV], start: 1, release: null };
    const mix = { param: 'mix', source: 1, amount: 0.4, min: 0, max: 1 };
    const drive = { param: 'drive', source: 1, amount: 6, min: 0, max: 12 };
    // a slot with the lines 6 and 7 of an fx-mod: the line and the params of each set
    const setupLines = (linearMix = false) => {
      const audioCtx = new AudioContext();
      const core = { ...createCore(audioCtx), linearMix };
      const fxMod = { set: jest.fn() };
      const slot = createFxSlot(audioCtx, core, { fxMod: fxMod as unknown as FxMod, dry: 6, wet: 7 });
      const lineOf = (index: number) =>
        fxMod.set.mock.calls
          .filter(([line]) => line === index)
          .at(-1)
          ?.slice(1);
      return { slot, core, fxMod, lineOf };
    };

    it('moves the mix by two lines on its gains, gives the core the routes of its knobs', () => {
      const { slot, core, lineOf } = setupLines(true);
      slot.setMix(0.5, true);
      slot.setModulation({ note, routes: [mix, drive] });
      expect(core.setModulation).toHaveBeenLastCalledWith({ note, routes: [drive] });
      expect(lineOf(6)).toEqual([{ routes: [mix], base: 0.5, map: 'dryLinear' }, [slot.dry.gain]]);
      expect(lineOf(7)).toEqual([{ routes: [mix], base: 0.5, map: 'wetLinear' }, [slot.wet.gain]]);
    });

    it('an equal power mix maps by it; a knob turned gives the lines its value, the gains glide as ever', () => {
      const { slot, lineOf } = setupLines();
      slot.setModulation({ note, routes: [mix] });
      slot.setMix(0.3, true);
      expect(lineOf(7)?.[0]).toEqual({ routes: [mix], base: 0.3, map: 'wet' });
      expect((slot.wet.gain.setTargetAtTime as jest.Mock).mock.lastCall?.[0]).toBeCloseTo(
        Math.sin((0.3 * Math.PI) / 2),
        9
      );
    });

    it('bypassed or its routes gone: no line, the gains at the knob', () => {
      const { slot, core, lineOf } = setupLines();
      slot.setMix(0.5, true);
      slot.setModulation({ note, routes: [mix] });
      slot.setMix(0.5, false);
      expect(lineOf(7)?.[0]).toBeNull();
      expect((slot.wet.gain.setTargetAtTime as jest.Mock).mock.lastCall?.[0]).toBe(0);
      slot.setMix(0.5, true);
      expect(lineOf(7)?.[0]).toEqual({ routes: [mix], base: 0.5, map: 'wet' });
      slot.setModulation(null);
      expect(lineOf(7)?.[0]).toBeNull();
      expect(core.setModulation).toHaveBeenLastCalledWith(null);
    });

    it('the routes of the note to the knobs of the LFOs alone move no knob of the core', () => {
      const { slot, core } = setupLines();
      const lfoRoute = { param: 'mix', source: 4, amount: 0.4, min: 0, max: 1 };
      const knob = { param: 'lfo1.rate', source: 1, amount: 1, min: 1 / 32, max: 100, scale: 'log' as const };
      slot.setModulation({ note: null, routes: [lfoRoute, knob] });
      expect(core.setModulation).toHaveBeenLastCalledWith(null);
      slot.setModulation({ note: null, routes: [{ ...drive, source: 4 }, knob] });
      expect(core.setModulation).toHaveBeenLastCalledWith({
        note: null,
        routes: [{ ...drive, source: 4 }, knob],
      });
    });
  });
});
