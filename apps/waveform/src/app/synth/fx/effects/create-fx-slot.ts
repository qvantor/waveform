import { BehaviorSubject } from 'rxjs';
import { noop } from 'lodash';
import { FxCore, FxStatus } from './types';

// smooths param changes, so mix, bypass and effect params don't click
export const setSmooth = (
  audioCtx: BaseAudioContext,
  param: AudioParam,
  value: number,
  timeConstant = 0.01
) => param.setTargetAtTime(value, audioCtx.currentTime, timeConstant);

export type FxSlot = ReturnType<typeof createFxSlot>;

// [dry, wet] gains of the mix (0: only dry, 1: only wet). Equal power: both at -3 dB at 0.5, the level stays
// flat when wet and dry are unrelated (echoes, reverb); linear: both at -6 dB, for a wet signal in time with
// the dry one (FxCore.linearMix), where equal power would be 3 dB louder
export const mixGains = (mix: number, linear = false): [number, number] =>
  linear ? [1 - mix, mix] : [Math.cos((mix * Math.PI) / 2), Math.sin((mix * Math.PI) / 2)];

// input → dry → output (mix: crossfade of dry and wet, mixGains; bypassed: only dry)
// input → send → core → wet → output (send is closed while inactive, so the core gets no new signal)
// a core with latency: input → dry delay (the latency) → dry, the same for bypass and mix, so the timing
// doesn't jump and the mix doesn't comb filter
// core → drain (muted) → destination: the core stays rendered while the slot is out of the chain, so its
// loops drain (a disconnected delay freezes its buffer and replays the old tail when added back)
export const createFxSlot = (audioCtx: BaseAudioContext, core: FxCore) => {
  const input = audioCtx.createGain();
  const output = audioCtx.createGain();
  const dry = audioCtx.createGain();
  const wet = audioCtx.createGain();
  const send = audioCtx.createGain();
  const drain = audioCtx.createGain();
  const { latency = 0, linearMix = false } = core;
  const dryDelay = latency > 0 ? audioCtx.createDelay(latency) : undefined;

  dryDelay?.delayTime.setValueAtTime(latency, audioCtx.currentTime);
  (dryDelay ? input.connect(dryDelay) : input).connect(dry);
  dry.connect(output);
  input.connect(send);
  send.connect(core.input);
  core.output.connect(wet);
  wet.connect(output);
  core.output.connect(drain);
  drain.connect(audioCtx.destination);
  drain.gain.setValueAtTime(0, audioCtx.currentTime);
  // closed until the fx model activates the slot and sets the mix
  send.gain.setValueAtTime(0, audioCtx.currentTime);
  wet.gain.setValueAtTime(0, audioCtx.currentTime);

  const setGain = (node: GainNode, value: number) => setSmooth(audioCtx, node.gain, value);

  return {
    input,
    output,
    dry,
    dryDelay,
    wet,
    send,
    drain,
    setParam: core.setParam,
    // an effect without a status is always ready, it has nothing to retry
    $status: core.$status ?? new BehaviorSubject<FxStatus>('ready'),
    retry: core.retry ?? noop,
    // the crossfade of mixGains (both gains glide alike, so a linear one keeps their sum); bypassed: only
    // the dry signal passes
    setMix: (mix: number, on: boolean) => {
      const [dryGain, wetGain] = on ? mixGains(mix, linearMix) : [1, 0];
      setGain(dry, dryGain);
      setGain(wet, wetGain);
    },
    // active: in the chain and not bypassed
    setActive: (active: boolean) => {
      setGain(send, active ? 1 : 0);
      core.setActive(active);
    },
    destroy: () => {
      core.destroy();
      [input, output, dry, wet, send, drain, dryDelay].forEach((node) => node?.disconnect());
    },
  };
};
