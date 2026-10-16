import { mapValues } from 'lodash';
import { FX_MIX_PARAM, FX_PARAMS, FX_TYPES } from '@waveform/preset-schema';
import { applySnapshot, getSnapshot } from '../../../app';
import { createSynthCore, initModel } from '../../../../test-utils/models';
import { withoutAudioWorklet } from '../../../../test-utils/no-audio-worklet';
import { workletLoads } from '../../../../test-utils/worklet-loads';
import { DELAY_PRESETS } from '../effects/delay-presets';
import { DISTORTION_LATENCY } from '../effects/distortion-dsp';
import { REVERB_PRESETS } from '../effects/reverb-presets';
import { findFxPreset, FxStatus } from '../effects';
import { fx, getChain } from './fx';

const setup = () => {
  const synthCore = createSynthCore();
  const createDelay = jest.spyOn(synthCore[0].audioCtx, 'createDelay');
  const createBiquadFilter = jest.spyOn(synthCore[0].audioCtx, 'createBiquadFilter');
  const [model, actions] = initModel(fx({ synthCore }), 'fx', undefined);
  // the left delay line (the first one as long as the longest time) and its bandpass, the bandpass feeds the
  // line back through the feedback gain
  const line = createDelay.mock.calls.findIndex(([max]) => max === FX_PARAMS.delay.time.max);
  const delayNode = createDelay.mock.results[line].value as DelayNode;
  const filterNode = createBiquadFilter.mock.results[0].value as BiquadFilterNode;
  const feedback = (filterNode.connect as jest.Mock).mock.calls[0][0] as GainNode;
  return { model, actions, synthCore: synthCore[0], delayNode, feedback };
};

const REVERB_DEFAULTS = mapValues(FX_PARAMS.reverb, (param) => param.default);
const DISTORTION_DEFAULTS = mapValues(FX_PARAMS.distortion, (param) => param.default);
const defaultReverb = () => ({ mix: FX_MIX_PARAM.default, params: REVERB_DEFAULTS });

const lastGain = (node: GainNode) => (node.gain.setTargetAtTime as jest.Mock).mock.lastCall?.[0];

// the reverb worklet module loads asynchronously: settled after the pending promises
const flush = () => new Promise((resolve) => setTimeout(resolve));

// the reverb module fails to load on the first try, the other modules load
const setupFailing = () => {
  const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const synthCore = createSynthCore();
  const addModule = synthCore[0].audioCtx.audioWorklet.addModule as jest.Mock;
  let failed = false;
  addModule.mockImplementation((url: string) => {
    if (failed || !url.endsWith('/reverb.js')) return Promise.resolve();
    failed = true;
    return Promise.reject(new Error('404'));
  });
  const [model, actions] = initModel(fx({ synthCore }), 'fx', undefined);
  return { model, actions, synthCore: synthCore[0], addModule, error };
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
    expect(getChain(['delay'], model.$effects.value, model.$status.value)).toEqual(['delay']);
    expect(getChain([], model.$effects.value, model.$status.value)).toEqual([]);
  });

  it('getChain keeps loading and ready effects, leaves out unsupported and failed ones', () => {
    const { model, actions } = setup();
    actions.setAdded('delay', true);
    actions.setAdded('reverb', true);
    const chain = (reverb: FxStatus) =>
      getChain(['reverb', 'delay'], model.$effects.value, { distortion: 'ready', delay: 'ready', reverb });
    expect(chain('loading')).toEqual(['reverb', 'delay']);
    expect(chain('ready')).toEqual(['reverb', 'delay']);
    expect(chain('unsupported')).toEqual(['delay']);
    expect(chain('failed')).toEqual(['delay']);
  });

  it('move reorders the effects', () => {
    const { model, actions } = setup();
    actions.move(0, 0);
    expect(model.$order.value).toEqual(['distortion', 'delay', 'reverb']);
    actions.move(2, 0);
    expect(model.$order.value).toEqual(['reverb', 'distortion', 'delay']);
    actions.move(1, 2);
    expect(model.$order.value).toEqual(['reverb', 'delay', 'distortion']);
  });

  describe('distortion', () => {
    it('is first in the chain by default', async () => {
      const { model, actions, synthCore } = setup();
      const { distortion, delay, reverb } = model.slots;
      expect(model.$order.value).toEqual(['distortion', 'delay', 'reverb']);
      FX_TYPES.forEach((type) => actions.setAdded(type, true));
      await flush();
      expect(synthCore.fxIn.connect).toHaveBeenLastCalledWith(distortion.input);
      expect(distortion.output.connect).toHaveBeenLastCalledWith(delay.input);
      expect(delay.output.connect).toHaveBeenLastCalledWith(reverb.input);
      expect(reverb.output.connect).toHaveBeenLastCalledWith(synthCore.fxOut);
    });

    it('its slot delays the dry signal by the latency of the worklet, the others have none', () => {
      const { model, synthCore } = setup();
      const { dryDelay } = model.slots.distortion;
      expect(dryDelay?.delayTime.setValueAtTime).toHaveBeenCalledWith(
        DISTORTION_LATENCY / synthCore.audioCtx.sampleRate,
        0
      );
      expect(model.slots.distortion.input.connect).toHaveBeenCalledWith(dryDelay);
      expect(dryDelay?.connect).toHaveBeenCalledWith(model.slots.distortion.dry);
      expect(model.slots.delay.dryDelay).toBeUndefined();
      expect(model.slots.reverb.dryDelay).toBeUndefined();
    });

    it('passes the changed params to the effect, activates it once ready', async () => {
      const { model, actions } = setup();
      const setParam = jest.spyOn(model.slots.distortion, 'setParam');
      const { send } = model.slots.distortion;
      actions.setAdded('distortion', true);
      actions.setParam('distortion', 'drive', 9);
      expect(setParam.mock.calls).toEqual([['drive', 9]]);
      expect(lastGain(send)).toBe(0);
      await flush();
      expect(lastGain(send)).toBe(1);
    });

    it('crossfades dry and wet linearly: the wet signal is the dry one reshaped, in time with it', async () => {
      const { model, actions } = setup();
      const { dry, wet } = model.slots.distortion;
      actions.setAdded('distortion', true);
      await flush();
      actions.setMix('distortion', 0.5);
      expect(lastGain(dry)).toBeCloseTo(0.5);
      expect(lastGain(wet)).toBeCloseTo(0.5);
      actions.setMix('distortion', 0.25);
      expect(lastGain(dry)).toBeCloseTo(0.75);
      expect(lastGain(wet)).toBeCloseTo(0.25);
      actions.setOn('distortion', false);
      expect(lastGain(dry)).toBe(1);
      expect(lastGain(wet)).toBe(0);
    });

    it('a fresh distortion matches the default preset, its presets are found back', () => {
      const { model, actions } = setup();
      expect(findFxPreset('distortion', model.$effects.value.distortion)?.id).toBe('default');
      actions.applyPreset('distortion', 'crunch');
      expect(findFxPreset('distortion', model.$effects.value.distortion)?.id).toBe('crunch');
    });
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

      actions.move(2, 0);
      expect(synthCore.fxIn.connect).toHaveBeenLastCalledWith(reverb.input);
      expect(reverb.output.connect).toHaveBeenLastCalledWith(delay.input);
      expect(delay.output.connect).toHaveBeenLastCalledWith(synthCore.fxOut);

      actions.setAdded('delay', false);
      expect(synthCore.fxIn.connect).toHaveBeenLastCalledWith(reverb.input);
      expect(reverb.output.connect).toHaveBeenLastCalledWith(synthCore.fxOut);
    });

    it('changes only the effect it is called for', async () => {
      const { model, actions } = setup();
      const delayBefore = model.$effects.value.delay;
      const delaySend = model.slots.delay.send.gain.setTargetAtTime as jest.Mock;
      delaySend.mockClear();
      actions.setAdded('reverb', true);
      actions.setParam('reverb', 'decay', 5);
      actions.setMix('reverb', 0.6);
      expect(model.$effects.value.delay).toBe(delayBefore);
      expect(model.$effects.value.reverb).toMatchObject({ added: true, mix: 0.6, params: { decay: 5 } });
      // the reverb is activated once its module has loaded
      await flush();
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

  describe('status', () => {
    afterEach(() => jest.restoreAllMocks());

    it('delay is always ready, the worklet effects are ready once their modules have loaded', async () => {
      const { model, synthCore } = setup();
      expect(model.$status.value).toEqual({ distortion: 'loading', delay: 'ready', reverb: 'loading' });
      await flush();
      expect(model.$status.value).toEqual({ distortion: 'ready', delay: 'ready', reverb: 'ready' });
      const addModule = synthCore.audioCtx.audioWorklet.addModule as jest.Mock;
      expect(workletLoads(addModule, 'distortion')).toBe(1);
      expect(workletLoads(addModule, 'reverb')).toBe(1);
    });

    it('a loading reverb is already in the chain and passes the dry signal until its node exists', async () => {
      const { model, actions, synthCore } = setup();
      const { dry, wet, send } = model.slots.reverb;
      actions.setMix('reverb', 1);
      actions.setAdded('reverb', true);
      expect(model.$status.value.reverb).toBe('loading');
      expect(synthCore.fxIn.connect).toHaveBeenLastCalledWith(model.slots.reverb.input);
      // not silent at mix 1: only dry, at full level, and inactive
      expect(lastGain(dry)).toBe(1);
      expect(lastGain(wet)).toBe(0);
      expect(lastGain(send)).toBe(0);
      const rewires = (synthCore.fxIn.disconnect as jest.Mock).mock.calls.length;

      await flush();
      expect(model.$status.value.reverb).toBe('ready');
      expect(lastGain(dry)).toBeCloseTo(0);
      expect(lastGain(wet)).toBeCloseTo(1);
      expect(lastGain(send)).toBe(1);
      // it was in the chain already
      expect(synthCore.fxIn.disconnect).toHaveBeenCalledTimes(rewires);
    });

    it('a bypassed reverb stays bypassed and inactive once ready', async () => {
      const { model, actions } = setup();
      const { dry, wet, send } = model.slots.reverb;
      actions.setOn('reverb', false);
      actions.setAdded('reverb', true);
      await flush();
      expect(model.$status.value.reverb).toBe('ready');
      expect(lastGain(dry)).toBe(1);
      expect(lastGain(wet)).toBe(0);
      expect(lastGain(send)).toBe(0);
    });

    it('without AudioWorklet the model starts, the worklet effects are unsupported, the delay works', () => {
      withoutAudioWorklet();
      const { model, actions, synthCore } = setup();
      expect(model.$status.value).toEqual({
        distortion: 'unsupported',
        delay: 'ready',
        reverb: 'unsupported',
      });
      actions.setAdded('delay', true);
      expect(synthCore.fxIn.connect).toHaveBeenLastCalledWith(model.slots.delay.input);
      expect(model.slots.delay.output.connect).toHaveBeenLastCalledWith(synthCore.fxOut);
    });

    it('an unsupported effect can not be added, removing it still works', () => {
      withoutAudioWorklet();
      const { model, actions } = setup();
      const before = model.$effects.value;
      actions.setAdded('reverb', true);
      expect(model.$effects.value).toBe(before);
      applySnapshot({ fx: { reverb: { a: true } } });
      actions.setAdded('reverb', false);
      expect(model.$effects.value.reverb.added).toBe(false);
    });

    it('an unsupported effect added by a snapshot stays out of the chain, the snapshot keeps it', () => {
      withoutAudioWorklet();
      const { model, synthCore } = setup();
      applySnapshot({ fx: { o: ['reverb', 'delay'], reverb: { a: true, decay: 5 }, delay: { a: true } } });
      expect(model.$effects.value.reverb).toMatchObject({ added: true, params: { decay: 5 } });
      expect(synthCore.fxIn.connect).toHaveBeenLastCalledWith(model.slots.delay.input);
      expect(model.slots.delay.output.connect).toHaveBeenLastCalledWith(synthCore.fxOut);
      expect(model.slots.reverb.output.connect).not.toHaveBeenCalledWith(synthCore.fxOut);
      expect(getSnapshot()['fx']).toMatchObject({ reverb: { a: true, decay: 5 }, delay: { a: true } });
    });

    it('a failed load reports the reverb as failed and drops it out of the chain', async () => {
      const { model, actions, synthCore, error } = setupFailing();
      actions.setAdded('reverb', true);
      expect(synthCore.fxIn.connect).toHaveBeenLastCalledWith(model.slots.reverb.input);
      await flush();
      expect(model.$status.value.reverb).toBe('failed');
      expect(error).toHaveBeenCalled();
      expect(model.$effects.value.reverb.added).toBe(true);
      expect(synthCore.fxIn.connect).toHaveBeenLastCalledWith(synthCore.fxOut);
    });

    it('adding a failed effect loads it again and puts it in the chain', async () => {
      const { model, actions, synthCore, addModule } = setupFailing();
      await flush();
      expect(model.$status.value.reverb).toBe('failed');
      expect(workletLoads(addModule, 'reverb')).toBe(1);

      actions.setAdded('reverb', true);
      expect(workletLoads(addModule, 'reverb')).toBe(2);
      expect(model.$status.value.reverb).toBe('loading');
      expect(model.$effects.value.reverb.added).toBe(true);
      expect(synthCore.fxIn.connect).toHaveBeenLastCalledWith(model.slots.reverb.input);
      await flush();
      expect(model.$status.value.reverb).toBe('ready');
      expect(synthCore.fxIn.connect).toHaveBeenLastCalledWith(model.slots.reverb.input);
    });

    it('a retry that fails again leaves the effect added but out of the chain', async () => {
      const { model, actions, synthCore, addModule } = setupFailing();
      await flush();
      addModule.mockRejectedValueOnce(new Error('offline'));
      actions.setAdded('reverb', true);
      await flush();
      expect(model.$status.value.reverb).toBe('failed');
      expect(model.$effects.value.reverb.added).toBe(true);
      expect(synthCore.fxIn.connect).toHaveBeenLastCalledWith(synthCore.fxOut);
    });

    it('removing a failed effect does not retry', async () => {
      const { model, actions, addModule } = setupFailing();
      await flush();
      actions.setAdded('reverb', false);
      expect(workletLoads(addModule, 'reverb')).toBe(1);
      expect(model.$status.value.reverb).toBe('failed');
    });

    it('retry loads a failed effect again without adding it, does nothing once it is ready', async () => {
      const { model, actions, synthCore, addModule } = setupFailing();
      await flush();
      actions.retry('reverb');
      expect(workletLoads(addModule, 'reverb')).toBe(2);
      expect(model.$status.value.reverb).toBe('loading');
      await flush();
      expect(model.$status.value.reverb).toBe('ready');
      expect(model.$effects.value.reverb.added).toBe(false);
      expect(synthCore.fxIn.connect).toHaveBeenLastCalledWith(synthCore.fxOut);
      actions.retry('reverb');
      expect(workletLoads(addModule, 'reverb')).toBe(2);
    });

    it('a failed effect is inactive and passes the dry signal, retry activates it once ready', async () => {
      const { model, actions } = setupFailing();
      const { dry, wet, send } = model.slots.reverb;
      actions.setMix('reverb', 1);
      actions.setAdded('reverb', true);
      await flush();
      expect(model.$status.value.reverb).toBe('failed');
      expect(lastGain(send)).toBe(0);
      expect(lastGain(dry)).toBe(1);
      expect(lastGain(wet)).toBe(0);

      actions.retry('reverb');
      await flush();
      expect(model.$status.value.reverb).toBe('ready');
      expect(model.$effects.value.reverb.added).toBe(true);
      expect(lastGain(send)).toBe(1);
      expect(lastGain(dry)).toBeCloseTo(0);
      expect(lastGain(wet)).toBeCloseTo(1);
    });

    it('a processor error deactivates the effect, a retry activates it again', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const { model, actions, synthCore } = setup();
      const { send } = model.slots.reverb;
      actions.setAdded('reverb', true);
      await flush();
      expect(lastGain(send)).toBe(1);

      // the slot's send feeds the reverb input, the reverb input feeds the worklet node
      const reverbInput = (send.connect as jest.Mock).mock.calls[0][0] as GainNode;
      const node = (reverbInput.connect as jest.Mock).mock.lastCall?.[0] as AudioWorkletNode;
      node.onprocessorerror?.call(node, new Event('processorerror'));
      expect(model.$status.value.reverb).toBe('failed');
      expect(lastGain(send)).toBe(0);
      expect(synthCore.fxIn.connect).toHaveBeenLastCalledWith(synthCore.fxOut);

      actions.retry('reverb');
      await flush();
      expect(model.$status.value.reverb).toBe('ready');
      expect(lastGain(send)).toBe(1);
      expect(synthCore.fxIn.connect).toHaveBeenLastCalledWith(model.slots.reverb.input);
    });

    it('an unsupported effect added by a snapshot is inactive and passes the dry signal', () => {
      withoutAudioWorklet();
      const { model } = setup();
      const { dry, wet, send } = model.slots.reverb;
      applySnapshot({ fx: { reverb: { a: true, mix: 1 } } });
      expect(model.$effects.value.reverb).toMatchObject({ added: true, mix: 1 });
      expect(lastGain(send)).toBe(0);
      expect(lastGain(dry)).toBe(1);
      expect(lastGain(wet)).toBe(0);
    });
  });

  describe('snapshot', () => {
    it('exposes the persisted state', () => {
      const { actions } = setup();
      actions.setAdded('delay', true);
      actions.setMix('delay', 0.5);
      actions.setParam('delay', 'fb', 0.2);
      expect(getSnapshot()['fx']).toEqual({
        o: ['distortion', 'delay', 'reverb'],
        distortion: { a: false, on: true, mix: 1, ...DISTORTION_DEFAULTS },
        delay: { a: true, on: true, mix: 0.5, mode: 0, pan: 0, time: 0.2, fb: 0.2, freq: 1000, q: 0.01 },
        reverb: { a: false, on: true, mix: 0.3, ...REVERB_DEFAULTS },
      });
    });

    it('round-trips the reverb, falsy values included, missing keys are defaults', () => {
      const { model, actions } = setup();
      actions.move(2, 0);
      actions.setAdded('reverb', true);
      actions.setOn('reverb', false);
      actions.setMix('reverb', 0);
      ['pre', 'size', 'depth', 'sep', 'er', 'era'].forEach((key) => actions.setParam('reverb', key, 0));
      actions.setParam('reverb', 'decay', 12);
      const snapshot = getSnapshot();
      expect(snapshot['fx']).toMatchObject({
        o: ['reverb', 'distortion', 'delay'],
        reverb: { a: true, on: false, mix: 0 },
      });

      actions.applyPreset('reverb', 'plate');
      actions.setOn('reverb', true);
      actions.move(1, 0);
      applySnapshot(snapshot);
      expect(model.$order.value).toEqual(['reverb', 'distortion', 'delay']);
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

    it('drops unknown and duplicate effects from the order, a missing one takes its default place', () => {
      const { model } = setup();
      applySnapshot({ fx: { o: ['chorus', 'reverb', 'delay', 'delay'] } });
      expect(model.$order.value).toEqual(['distortion', 'reverb', 'delay']);
      // a snapshot from before the distortion: it goes first, in front of the delay
      applySnapshot({ fx: { o: ['delay', 'reverb'] } });
      expect(model.$order.value).toEqual(['distortion', 'delay', 'reverb']);
      applySnapshot({ fx: { o: ['delay'] } });
      expect(model.$order.value).toEqual(['distortion', 'delay', 'reverb']);
      applySnapshot({ fx: { o: [] } });
      expect(model.$order.value).toEqual([...FX_TYPES]);
    });

    it('round-trips the distortion, falsy values included, missing keys are defaults', () => {
      const { model, actions } = setup();
      actions.setAdded('distortion', true);
      actions.setOn('distortion', false);
      actions.setMix('distortion', 0);
      actions.setParam('distortion', 'mode', 1);
      actions.setParam('distortion', 'mode', 0);
      actions.setParam('distortion', 'drive', 0);
      actions.setParam('distortion', 'level', 0);
      actions.setParam('distortion', 'tone', 500);
      const snapshot = getSnapshot();
      expect(snapshot['fx']).toMatchObject({
        distortion: { a: true, on: false, mix: 0, mode: 0, drive: 0, tone: 500, level: 0 },
      });

      actions.applyPreset('distortion', 'fuzz');
      actions.setOn('distortion', true);
      applySnapshot(snapshot);
      expect(model.$effects.value.distortion).toEqual({
        added: true,
        on: false,
        mix: 0,
        params: { mode: 0, drive: 0, tone: 500, level: 0 },
      });

      // all wet by default, unlike the delay and the reverb
      applySnapshot({ fx: { distortion: { a: true, drive: 9 } } });
      expect(model.$effects.value.distortion).toEqual({
        added: true,
        on: true,
        mix: 1,
        params: { ...DISTORTION_DEFAULTS, drive: 9 },
      });
      expect(model.$effects.value.delay.mix).toBe(0.3);
    });
  });
});
