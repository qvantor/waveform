import { applySnapshot, getSnapshot } from '../../../app';
import { createSynthCore, initModel } from '../../../../test-utils/models';
import { fx, getChain } from './fx';

const setup = () => {
  const synthCore = createSynthCore();
  const createDelay = jest.spyOn(synthCore[0].audioCtx, 'createDelay');
  const [model, actions] = initModel(fx({ synthCore }), 'fx', undefined);
  const delayNode = createDelay.mock.results[0].value as DelayNode;
  return { model, actions, synthCore: synthCore[0], delayNode };
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
    actions.setParam('delay', 'time', 1);
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
    const { model, actions, delayNode } = setup();
    const { send } = model.slots.delay;
    const feedback = (delayNode.connect as jest.Mock).mock.calls[0][0] as GainNode;
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
        delay: { a: true, on: true, mix: 0.5, time: 0.3, fb: 0.2 },
      });
    });

    it('applies falsy values and restores defaults for missing keys', () => {
      const { model, actions } = setup();
      actions.setAdded('delay', true);
      actions.setParam('delay', 'time', 1);

      applySnapshot({ fx: { delay: { a: true, on: false, mix: 0, fb: 0 } } });
      expect(model.$effects.value.delay).toEqual({
        added: true,
        on: false,
        mix: 0,
        params: { time: 0.3, fb: 0 },
      });

      applySnapshot({});
      expect(model.$effects.value.delay.added).toBe(false);
    });

    it('ignores wrong types and clamps numbers out of range (legacy url params)', () => {
      const { model } = setup();
      applySnapshot({ fx: { delay: { a: 'yes', on: 1, mix: 'x', fb: 1.5, time: -1 } } });
      expect(model.$effects.value.delay).toEqual({
        added: false,
        on: true,
        mix: 0.3,
        params: { time: 0.01, fb: 0.9 },
      });

      applySnapshot({ fx: { delay: { mix: Infinity, time: '1' } } });
      expect(model.$effects.value.delay).toMatchObject({ mix: 0.3, params: { time: 0.3 } });
    });

    it('uses the defaults when the effect value is not an object', () => {
      const { model, actions } = setup();
      actions.setAdded('delay', true);
      applySnapshot({ fx: { delay: 'on' } });
      expect(model.$effects.value.delay).toEqual({
        added: false,
        on: true,
        mix: 0.3,
        params: { time: 0.3, fb: 0.4 },
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
