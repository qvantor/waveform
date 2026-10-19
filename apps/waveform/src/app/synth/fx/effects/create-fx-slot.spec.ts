import { BehaviorSubject } from 'rxjs';
import { createFxSlot, FxSlot, mixGains } from './create-fx-slot';
import { FxCore, FxStatus } from './types';

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
    const mix = { param: 'mix', env: 1, amount: 0.4, min: 0, max: 1 };
    const drive = { param: 'drive', env: 1, amount: 6, min: 0, max: 12 };
    const calls = (param: AudioParam, method: keyof AudioParam) => (param[method] as jest.Mock).mock.calls;

    it('moves a linear mix by ramps of both gains, gives the core the routes of its knobs', () => {
      const audioCtx = new AudioContext();
      const core = { ...createCore(audioCtx), linearMix: true };
      const slot = createFxSlot(audioCtx, core);
      slot.setMix(0.5, true);
      slot.setModulation({ note, routes: [mix, drive] });
      expect(core.setModulation).toHaveBeenLastCalledWith({ note, routes: [drive] });
      // at the top of the attack the mix is 0.9
      expect(calls(slot.wet.gain, 'linearRampToValueAtTime')[0]).toEqual([
        expect.closeTo(0.9, 9),
        expect.closeTo(1.1, 9),
      ]);
      expect(calls(slot.dry.gain, 'linearRampToValueAtTime')[0]).toEqual([
        expect.closeTo(0.1, 9),
        expect.closeTo(1.1, 9),
      ]);
    });

    it('moves an equal power mix by linear segments of both gains', () => {
      const audioCtx = new AudioContext();
      const slot = createFxSlot(audioCtx, createCore(audioCtx));
      slot.setMix(0.5, true);
      slot.setModulation({ note, routes: [mix] });
      // the 15 segments of the attack, the mix at 0.9 at its top
      expect(calls(slot.wet.gain, 'linearRampToValueAtTime')[14]).toEqual([
        expect.closeTo(Math.sin((0.9 * Math.PI) / 2), 6),
        expect.closeTo(1.1, 9),
      ]);
      expect(calls(slot.dry.gain, 'linearRampToValueAtTime')[14]).toEqual([
        expect.closeTo(Math.cos((0.9 * Math.PI) / 2), 6),
        expect.closeTo(1.1, 9),
      ]);
    });

    it('a mix without routes glides from where it is: its ticks cancel nothing', () => {
      const audioCtx = new AudioContext();
      const slot = createFxSlot(audioCtx, createCore(audioCtx));
      [0.2, 0.3, 0.4].forEach((value) => slot.setMix(value, true));
      [slot.dry.gain, slot.wet.gain].forEach((gain) =>
        expect(gain.cancelScheduledValues).not.toHaveBeenCalled()
      );
      // the routes gone: their automation is left where it is once, then the ticks glide again
      slot.setModulation({ note, routes: [mix] });
      slot.setModulation(null);
      const cancels = calls(slot.wet.gain, 'cancelScheduledValues').length;
      expect(calls(slot.wet.gain, 'setValueAtTime').at(-1)?.[1]).toBe(audioCtx.currentTime);
      slot.setMix(0.6, true);
      slot.setMix(0.7, true);
      expect(calls(slot.wet.gain, 'cancelScheduledValues')).toHaveLength(cancels);
      expect((slot.wet.gain.setTargetAtTime as jest.Mock).mock.lastCall?.[0]).toBeCloseTo(
        Math.sin((0.7 * Math.PI) / 2),
        9
      );
    });

    it('a knob of the mix without routes, bypassed or not ready glides to its value; the core gets null', () => {
      const audioCtx = new AudioContext();
      const core = createCore(audioCtx);
      const slot = createFxSlot(audioCtx, core);
      slot.setMix(0.5, true);
      slot.setModulation({ note, routes: [mix] });
      slot.setMix(0.5, false);
      expect((slot.wet.gain.setTargetAtTime as jest.Mock).mock.lastCall?.[0]).toBe(0);
      slot.setMix(0.5, true);
      slot.setModulation(null);
      expect(core.setModulation).toHaveBeenLastCalledWith(null);
      expect((slot.wet.gain.setTargetAtTime as jest.Mock).mock.lastCall?.[0]).toBeCloseTo(Math.SQRT1_2, 9);
    });
  });
});
