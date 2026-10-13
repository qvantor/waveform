import { applySnapshot, getSnapshot } from '../../../app';
import { createSynthCore, initModel } from '../../../../test-utils/models';
import { DELAY_PRESETS } from '../effects/delay-presets';
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

  it('passes the dry signal at full level, mix sets the wet level, bypass mutes it', () => {
    const { model, actions } = setup();
    const { input, output, wet } = model.slots.delay;
    expect(input.connect).toHaveBeenCalledWith(output);

    actions.setMix('delay', 0.25);
    expect(wet.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.25, 0, expect.any(Number));

    actions.setOn('delay', false);
    expect(model.$effects.value.delay.on).toBe(false);
    expect(wet.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, expect.any(Number));
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

  it('applies the params to the delay node', () => {
    const { actions, delayNode } = setup();
    actions.setParam('delay', 'time', 0.5);
    expect(delayNode.delayTime.setTargetAtTime).toHaveBeenLastCalledWith(0.5, 0, expect.any(Number));
  });

  it('applies only the changed values', () => {
    const { model, actions, delayNode, feedback } = setup();
    actions.setAdded('delay', true);
    const wet = model.slots.delay.wet.gain.setTargetAtTime as jest.Mock;
    const send = model.slots.delay.send.gain.setTargetAtTime as jest.Mock;
    const time = delayNode.delayTime.setTargetAtTime as jest.Mock;
    const fb = feedback.gain.setTargetAtTime as jest.Mock;
    [wet, send, time, fb].forEach((mock) => mock.mockClear());

    actions.setParam('delay', 'time', 0.5);
    expect(time).toHaveBeenCalledTimes(1);
    expect(wet).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(fb).not.toHaveBeenCalled();

    actions.setMix('delay', 0.5);
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
      const { mix, params } = preset('tape-echo');
      expect(delayNode.delayTime.setTargetAtTime).toHaveBeenLastCalledWith(
        params.time,
        0,
        expect.any(Number)
      );
      expect(feedback.gain.setTargetAtTime).toHaveBeenLastCalledWith(params.fb, 0, expect.any(Number));
      expect(model.slots.delay.wet.gain.setTargetAtTime).toHaveBeenLastCalledWith(mix, 0, expect.any(Number));
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
      actions.applyPreset('delay', 'doubler');
      const snapshot = getSnapshot();
      expect(snapshot['fx']).toMatchObject({ delay: { fb: 0, mix: 0.4, pan: 0.015 } });

      actions.applyPreset('delay', 'dub');
      applySnapshot(snapshot);
      expect(findFxPreset('delay', model.$effects.value.delay)).toBe(preset('doubler'));
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
    expect(model.$order.value).toEqual(['delay']);
  });

  describe('snapshot', () => {
    it('exposes the persisted state', () => {
      const { actions } = setup();
      actions.setAdded('delay', true);
      actions.setMix('delay', 0.5);
      actions.setParam('delay', 'fb', 0.2);
      expect(getSnapshot()['fx']).toEqual({
        o: ['delay'],
        delay: { a: true, on: true, mix: 0.5, mode: 0, pan: 0, time: 0.2, fb: 0.2, freq: 1000, q: 0.01 },
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
      applySnapshot({ fx: { o: ['chorus', 'delay', 'delay'] } });
      expect(model.$order.value).toEqual(['delay']);
      applySnapshot({ fx: { o: [] } });
      expect(model.$order.value).toEqual(['delay']);
    });
  });
});
