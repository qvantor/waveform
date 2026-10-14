import { mapValues } from 'lodash';
import { FX_MIX_PARAM, FX_PARAMS } from '@waveform/preset-schema';
import { applySnapshot, getSnapshot } from '../../../app';
import { createSynthCore, initModel } from '../../../../test-utils/models';
import { DELAY_PRESETS } from '../effects/delay-presets';
import { REVERB_PRESETS } from '../effects/reverb-presets';
import { findFxPreset } from '../effects';
import { fx, getChain } from './fx';

const setup = () => {
  const synthCore = createSynthCore();
  const createDelay = jest.spyOn(synthCore[0].audioCtx, 'createDelay');
  const createBiquadFilter = jest.spyOn(synthCore[0].audioCtx, 'createBiquadFilter');
  const [model, actions] = initModel(fx({ synthCore }), 'fx', undefined);
  // the left delay line and its bandpass, the bandpass feeds the line back through the feedback gain
  const delayNode = createDelay.mock.results[0].value as DelayNode;
  const filterNode = createBiquadFilter.mock.results[0].value as BiquadFilterNode;
  const feedback = (filterNode.connect as jest.Mock).mock.calls[0][0] as GainNode;
  return { model, actions, synthCore: synthCore[0], delayNode, feedback };
};

const REVERB_DEFAULTS = mapValues(FX_PARAMS.reverb, (param) => param.default);
const defaultReverb = () => ({ mix: FX_MIX_PARAM.default, params: REVERB_DEFAULTS });

const lastGain = (node: GainNode) => (node.gain.setTargetAtTime as jest.Mock).mock.lastCall?.[0];

describe('fx', () => {
  it('passes fxIn straight to fxOut when no effect is added', () => {
    const { model, synthCore } = setup();
    expect(model.$effects.value.delay.added).toBe(false);
    expect(synthCore.fxIn.connect).toHaveBeenLastCalledWith(synthCore.fxOut);
  });

  it('setAdded inserts and removes the effect slot', () => {
    const { model, actions, synthCore } = setup();
    const slot = model.slots.delay;

    actions.setAdded('delay', true);
    expect(synthCore.fxIn.connect).toHaveBeenLastCalledWith(slot.input);
    expect(slot.output.connect).toHaveBeenLastCalledWith(synthCore.fxOut);

    actions.setAdded('delay', false);
    expect(slot.output.disconnect).toHaveBeenCalled();
    expect(synthCore.fxIn.connect).toHaveBeenLastCalledWith(synthCore.fxOut);
  });

  it('does not rewire the chain on param changes', () => {
    const { actions, synthCore } = setup();
    actions.setAdded('delay', true);
    const calls = (synthCore.fxIn.disconnect as jest.Mock).mock.calls.length;
    actions.setParam('delay', 'time', 0.5);
    actions.setMix('delay', 0.5);
    expect(synthCore.fxIn.disconnect).toHaveBeenCalledTimes(calls);
  });

  it('keeps send and wet closed until the slot is set up', () => {
    const synthCore = createSynthCore();
    const createGain = jest.spyOn(synthCore[0].audioCtx, 'createGain');
    const [model] = initModel(fx({ synthCore }), 'fx', undefined);
    const gains = createGain.mock.results.map(({ value }) => value as GainNode);
    const { send, wet } = model.slots.delay;
    expect(gains).toContain(send);
    [send, wet].forEach((node) => expect(node.gain.setValueAtTime).toHaveBeenCalledWith(0, 0));
  });

  it('crossfades dry and wet at equal power, bypass passes only the dry signal', () => {
    const { model, actions } = setup();
    const { input, output, dry, wet } = model.slots.delay;
    expect(input.connect).toHaveBeenCalledWith(dry);
    expect(dry.connect).toHaveBeenCalledWith(output);
    const expectGains = (dryGain: number, wetGain: number) => {
      expect(lastGain(dry)).toBeCloseTo(dryGain);
      expect(lastGain(wet)).toBeCloseTo(wetGain);
    };

    actions.setMix('delay', 0.25);
    expectGains(0.9239, 0.3827);
    actions.setMix('delay', 0.5);
    expectGains(Math.SQRT1_2, Math.SQRT1_2);
    actions.setMix('delay', 0.75);
    expectGains(0.3827, 0.9239);
    actions.setMix('delay', 0);
    expectGains(1, 0);
    actions.setMix('delay', 1);
    expectGains(0, 1);

    actions.setOn('delay', false);
    expect(model.$effects.value.delay.on).toBe(false);
    expectGains(1, 0);
    actions.setOn('delay', true);
    expectGains(0, 1);
  });

  it('closes the send and kills the delay feedback while removed or bypassed', () => {
    const { model, actions, feedback } = setup();
    const { send } = model.slots.delay;
    actions.setParam('delay', 'fb', 0.6);
    expect(send.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, expect.any(Number));
    expect(feedback.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, expect.any(Number));

    actions.setAdded('delay', true);
    expect(send.gain.setTargetAtTime).toHaveBeenLastCalledWith(1, 0, expect.any(Number));
    expect(feedback.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.6, 0, expect.any(Number));

    actions.setOn('delay', false);
    expect(send.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, expect.any(Number));
    expect(feedback.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, expect.any(Number));

    actions.setParam('delay', 'fb', 0.2);
    expect(feedback.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, expect.any(Number));
    actions.setOn('delay', true);
    expect(feedback.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.2, 0, expect.any(Number));

    actions.setAdded('delay', false);
    expect(feedback.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, expect.any(Number));
  });

  it('keeps the effect rendered through a muted drain while removed, so the delay empties', () => {
    const synthCore = createSynthCore();
    const { audioCtx } = synthCore[0];
    const createChannelMerger = jest.spyOn(audioCtx, 'createChannelMerger');
    const [model, actions] = initModel(fx({ synthCore }), 'fx', undefined);
    const { drain, wet } = model.slots.delay;
    // the delay output (merger) feeds both wet and the drain
    const coreOutput = createChannelMerger.mock.results[0].value as ChannelMergerNode;
    expect(coreOutput.connect).toHaveBeenCalledWith(wet);
    expect(coreOutput.connect).toHaveBeenCalledWith(drain);
    expect(drain.connect).toHaveBeenCalledWith(audioCtx.destination);
    expect(drain.gain.setValueAtTime).toHaveBeenCalledWith(0, 0);

    model.slots.delay.destroy();
    expect(drain.disconnect).toHaveBeenCalled();
  });

  it('applies the params to the delay node', () => {
    const { actions, delayNode } = setup();
    actions.setParam('delay', 'time', 0.5);
    expect(delayNode.delayTime.setTargetAtTime).toHaveBeenLastCalledWith(0.5, 0, expect.any(Number));
  });

  it('applies only the changed values', () => {
    const { model, actions, delayNode, feedback } = setup();
    actions.setAdded('delay', true);
    const dry = model.slots.delay.dry.gain.setTargetAtTime as jest.Mock;
    const wet = model.slots.delay.wet.gain.setTargetAtTime as jest.Mock;
    const send = model.slots.delay.send.gain.setTargetAtTime as jest.Mock;
    const time = delayNode.delayTime.setTargetAtTime as jest.Mock;
    const fb = feedback.gain.setTargetAtTime as jest.Mock;
    [dry, wet, send, time, fb].forEach((mock) => mock.mockClear());

    actions.setParam('delay', 'time', 0.5);
    expect(time).toHaveBeenCalledTimes(1);
    expect(dry).not.toHaveBeenCalled();
    expect(wet).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(fb).not.toHaveBeenCalled();

    actions.setMix('delay', 0.5);
    expect(dry).toHaveBeenCalledTimes(1);
    expect(wet).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
    expect(time).toHaveBeenCalledTimes(1);
  });

  describe('applyPreset', () => {
    const preset = (id: string) => {
      const found = DELAY_PRESETS.find((item) => item.id === id);
      if (!found) throw new Error(`no preset ${id}`);
      return found;
    };

    it('sets mix and every param in one change, keeps added and on', () => {
      const { model, actions } = setup();
      actions.setAdded('delay', true);
      actions.setOn('delay', false);
      const states: unknown[] = [];
      const subscription = model.$effects.subscribe(({ delay }) => states.push(delay));

      actions.applyPreset('delay', 'dub');
      expect(states).toHaveLength(2);
      expect(model.$effects.value.delay).toEqual({
        added: true,
        on: false,
        mix: preset('dub').mix,
        params: preset('dub').params,
      });
      expect(findFxPreset('delay', model.$effects.value.delay)).toBe(preset('dub'));
      subscription.unsubscribe();
    });

    it('applies the preset to the audio nodes', () => {
      const { model, actions, delayNode, feedback } = setup();
      actions.setAdded('delay', true);
      actions.applyPreset('delay', 'tape-echo');
      const { params } = preset('tape-echo');
      expect(delayNode.delayTime.setTargetAtTime).toHaveBeenLastCalledWith(
        params.time,
        0,
        expect.any(Number)
      );
      expect(feedback.gain.setTargetAtTime).toHaveBeenLastCalledWith(params.fb, 0, expect.any(Number));
      // mix 0.3
      expect(lastGain(model.slots.delay.dry)).toBeCloseTo(0.891);
      expect(lastGain(model.slots.delay.wet)).toBeCloseTo(0.454);
    });

    it('does not share the params object with the preset', () => {
      const { model, actions } = setup();
      actions.applyPreset('delay', 'slapback');
      actions.setParam('delay', 'time', 0.5);
      expect(preset('slapback').params.time).toBe(0.09);
      expect(model.$effects.value.delay.params).not.toBe(preset('slapback').params);
    });

    it('ignores an unknown id', () => {
      const { model, actions } = setup();
      const before = model.$effects.value;
      actions.applyPreset('delay', 'unknown');
      expect(model.$effects.value).toBe(before);
    });

    it('survives a snapshot round-trip, incl. zero feedback and pan', () => {
      const { model, actions } = setup();
      actions.setAdded('delay', true);
      actions.applyPreset('delay', 'stereo-widener');
      const snapshot = getSnapshot();
      expect(snapshot['fx']).toMatchObject({ delay: { fb: 0, mix: 0.35, pan: 0.018 } });

      actions.applyPreset('delay', 'dub');
      applySnapshot(snapshot);
      expect(findFxPreset('delay', model.$effects.value.delay)).toBe(preset('stereo-widener'));
    });

    it('a fresh effect matches the default preset', () => {
      const { model } = setup();
      expect(findFxPreset('delay', model.$effects.value.delay)?.id).toBe('default');
    });
  });

  it('$chain emits the added effects only when the chain changes', () => {
    const { model, actions } = setup();
    const chains: string[][] = [];
    const subscription = model.$chain.subscribe((chain) => chains.push(chain));

    actions.setAdded('delay', true);
    actions.setParam('delay', 'fb', 0.1);
    actions.setMix('delay', 0.6);
    actions.setAdded('delay', false);

    expect(chains).toEqual([[], ['delay'], []]);
    subscription.unsubscribe();
  });

  it('getChain keeps the order and only the added effects', () => {
    const { model, actions } = setup();
    actions.setAdded('delay', true);
    expect(getChain(['delay'], model.$effects.value)).toEqual(['delay']);
    expect(getChain([], model.$effects.value)).toEqual([]);
  });

  it('move reorders the effects', () => {
    const { model, actions } = setup();
    actions.move(0, 0);
    expect(model.$order.value).toEqual(['delay', 'reverb']);
    actions.move(1, 0);
    expect(model.$order.value).toEqual(['reverb', 'delay']);
  });

  describe('two effects', () => {
    it('wires the added effects in the chain order', () => {
      const { model, actions, synthCore } = setup();
      const { delay, reverb } = model.slots;
      actions.setAdded('delay', true);
      actions.setAdded('reverb', true);
      expect(synthCore.fxIn.connect).toHaveBeenLastCalledWith(delay.input);
      expect(delay.output.connect).toHaveBeenLastCalledWith(reverb.input);
      expect(reverb.output.connect).toHaveBeenLastCalledWith(synthCore.fxOut);

      actions.move(1, 0);
      expect(synthCore.fxIn.connect).toHaveBeenLastCalledWith(reverb.input);
      expect(reverb.output.connect).toHaveBeenLastCalledWith(delay.input);
      expect(delay.output.connect).toHaveBeenLastCalledWith(synthCore.fxOut);

      actions.setAdded('delay', false);
      expect(synthCore.fxIn.connect).toHaveBeenLastCalledWith(reverb.input);
      expect(reverb.output.connect).toHaveBeenLastCalledWith(synthCore.fxOut);
    });

    it('changes only the effect it is called for', () => {
      const { model, actions } = setup();
      const delayBefore = model.$effects.value.delay;
      const delaySend = model.slots.delay.send.gain.setTargetAtTime as jest.Mock;
      delaySend.mockClear();
      actions.setAdded('reverb', true);
      actions.setParam('reverb', 'decay', 5);
      actions.setMix('reverb', 0.6);
      expect(model.$effects.value.delay).toBe(delayBefore);
      expect(model.$effects.value.reverb).toMatchObject({ added: true, mix: 0.6, params: { decay: 5 } });
      expect(model.slots.reverb.send.gain.setTargetAtTime).toHaveBeenLastCalledWith(1, 0, expect.any(Number));
      expect(delaySend).not.toHaveBeenCalled();
    });

    it('applies a reverb preset and finds it back', () => {
      const { model, actions } = setup();
      actions.applyPreset('reverb', 'cathedral');
      const cathedral = REVERB_PRESETS.find(({ id }) => id === 'cathedral');
      expect(model.$effects.value.reverb).toMatchObject({ mix: cathedral?.mix, params: cathedral?.params });
      expect(findFxPreset('reverb', model.$effects.value.reverb)).toBe(cathedral);
      expect(findFxPreset('reverb', defaultReverb())?.id).toBe('default');
    });
  });

  describe('snapshot', () => {
    it('exposes the persisted state', () => {
      const { actions } = setup();
      actions.setAdded('delay', true);
      actions.setMix('delay', 0.5);
      actions.setParam('delay', 'fb', 0.2);
      expect(getSnapshot()['fx']).toEqual({
        o: ['delay', 'reverb'],
        delay: { a: true, on: true, mix: 0.5, mode: 0, pan: 0, time: 0.2, fb: 0.2, freq: 1000, q: 0.01 },
        reverb: { a: false, on: true, mix: 0.3, ...REVERB_DEFAULTS },
      });
    });

    it('round-trips the reverb, falsy values included, missing keys are defaults', () => {
      const { model, actions } = setup();
      actions.move(1, 0);
      actions.setAdded('reverb', true);
      actions.setOn('reverb', false);
      actions.setMix('reverb', 0);
      ['pre', 'size', 'depth', 'sep', 'er', 'era'].forEach((key) => actions.setParam('reverb', key, 0));
      actions.setParam('reverb', 'decay', 12);
      const snapshot = getSnapshot();
      expect(snapshot['fx']).toMatchObject({
        o: ['reverb', 'delay'],
        reverb: { a: true, on: false, mix: 0 },
      });

      actions.applyPreset('reverb', 'plate');
      actions.setOn('reverb', true);
      actions.move(1, 0);
      applySnapshot(snapshot);
      expect(model.$order.value).toEqual(['reverb', 'delay']);
      expect(model.$effects.value.reverb).toEqual({
        added: true,
        on: false,
        mix: 0,
        params: { ...REVERB_DEFAULTS, pre: 0, size: 0, depth: 0, sep: 0, er: 0, era: 0, decay: 12 },
      });

      applySnapshot({ fx: { reverb: { a: true, decay: 0.5 } } });
      expect(model.$effects.value.reverb).toEqual({
        added: true,
        on: true,
        mix: 0.3,
        params: { ...REVERB_DEFAULTS, decay: 0.5 },
      });
    });

    it('applies falsy values and restores defaults for missing keys', () => {
      const { model, actions } = setup();
      actions.setAdded('delay', true);
      actions.setParam('delay', 'time', 0.5);
      actions.setParam('delay', 'mode', 1);
      actions.setParam('delay', 'pan', 0.02);
      actions.setParam('delay', 'freq', 5000);

      applySnapshot({ fx: { delay: { a: true, on: false, mix: 0, fb: 0, mode: 0, pan: 0 } } });
      expect(model.$effects.value.delay).toEqual({
        added: true,
        on: false,
        mix: 0,
        params: { mode: 0, pan: 0, time: 0.2, fb: 0, freq: 1000, q: 0.01 },
      });

      applySnapshot({});
      expect(model.$effects.value.delay.added).toBe(false);
    });

    it('ignores wrong types and clamps numbers out of range (legacy url params)', () => {
      const { model } = setup();
      applySnapshot({
        fx: { delay: { a: 'yes', on: 1, mix: 'x', fb: 1.5, time: -1, mode: 3, pan: -2, freq: 'x', q: 5 } },
      });
      expect(model.$effects.value.delay).toEqual({
        added: false,
        on: true,
        mix: 0.3,
        params: { mode: 1, pan: -0.05, time: 0.01, fb: 0.9, freq: 1000, q: 3 },
      });

      applySnapshot({ fx: { delay: { mix: Infinity, time: '1' } } });
      expect(model.$effects.value.delay).toMatchObject({ mix: 0.3, params: { time: 0.2 } });
    });

    it('rounds int params so the preset schema accepts them', () => {
      const { model } = setup();
      applySnapshot({ fx: { delay: { mode: 0.6 } } });
      expect(model.$effects.value.delay.params['mode']).toBe(1);
      applySnapshot({ fx: { delay: { mode: 0.4 } } });
      expect(model.$effects.value.delay.params['mode']).toBe(0);
    });

    it('uses the defaults when the effect value is not an object', () => {
      const { model, actions } = setup();
      actions.setAdded('delay', true);
      applySnapshot({ fx: { delay: 'on' } });
      expect(model.$effects.value.delay).toEqual({
        added: false,
        on: true,
        mix: 0.3,
        params: { mode: 0, pan: 0, time: 0.2, fb: 0.5, freq: 1000, q: 0.01 },
      });
    });

    it('drops unknown and duplicate effects from the order and appends the missing ones', () => {
      const { model } = setup();
      applySnapshot({ fx: { o: ['chorus', 'reverb', 'delay', 'delay'] } });
      expect(model.$order.value).toEqual(['reverb', 'delay']);
      applySnapshot({ fx: { o: ['delay'] } });
      expect(model.$order.value).toEqual(['delay', 'reverb']);
      applySnapshot({ fx: { o: [] } });
      expect(model.$order.value).toEqual(['delay', 'reverb']);
    });
  });
});
