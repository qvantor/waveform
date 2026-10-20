import { BehaviorSubject } from 'rxjs';
import { noop } from 'lodash';
import { FxCore, FxStatus } from './types';
import { FxModulation, FxNote, FxRoute } from './fx-modulation';
import { glideParam, holdParam, scheduleRouted, setParam } from './fx-automation';

// smooths param changes, so mix, bypass and effect params don't click
export const setSmooth = (
  audioCtx: BaseAudioContext,
  param: AudioParam,
  value: number,
  timeConstant = 0.01
) => glideParam(param, value, audioCtx.currentTime, timeConstant);

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
  setParam(send.gain, 0, audioCtx.currentTime);
  setParam(wet.gain, 0, audioCtx.currentTime);

  const setGain = (node: GainNode, value: number) => setSmooth(audioCtx, node.gain, value);

  // the mix knob, on (not bypassed and ready) and the routes moving it with the note they follow
  let mix = { value: 0, on: false };
  let mixMod: { note: FxNote; routes: FxRoute[] } | null = null;
  // the gains follow the automation of the routes
  let routed = false;
  // the crossfade of mixGains: linear gains ramp, equal power ones are curves
  const applyMix = () => {
    const now = audioCtx.currentTime;
    if (mixMod && mix.on) {
      const { note, routes } = mixMod;
      const ramp = linearMix ? 'linear' : 'curve';
      scheduleRouted(dry.gain, now, note, routes, mix.value, ramp, (value) => mixGains(value, linearMix)[0]);
      scheduleRouted(wet.gain, now, note, routes, mix.value, ramp, (value) => mixGains(value, linearMix)[1]);
      routed = true;
      return;
    }
    // the automation is left where it is once, not at every tick of the knob: the value read here is a block
    // late, the glide would step back to it
    if (routed) {
      holdParam(dry.gain, now);
      holdParam(wet.gain, now);
      routed = false;
    }
    const [dryGain, wetGain] = mix.on ? mixGains(mix.value, linearMix) : [1, 0];
    setGain(dry, dryGain);
    setGain(wet, wetGain);
  };

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
    setMix: (value: number, on: boolean) => {
      mix = { value, on };
      applyMix();
    },
    // the routes of the envelopes of the last note: the mix moves the gains of the slot, the others the core
    setModulation: (mod: FxModulation | null) => {
      const mixRoutes = mod?.routes.filter(({ param }) => param === 'mix') ?? [];
      const routes = mod?.routes.filter(({ param }) => param !== 'mix') ?? [];
      const next = mod && mixRoutes.length > 0 ? { note: mod.note, routes: mixRoutes } : null;
      if (next || mixMod) {
        mixMod = next;
        applyMix();
      }
      core.setModulation(mod && routes.length > 0 ? { note: mod.note, routes } : null);
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
