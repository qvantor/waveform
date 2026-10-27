import { BehaviorSubject } from 'rxjs';
import { noop } from 'lodash';
import type { LfosState } from '../../common/lfo/lfo-curve';
import { FxCore, FxStatus } from './types';
import { FxModulation, FxRoute } from './fx-modulation';
import { glideParam, setParam } from './fx-automation';
import { mixGains } from './fx-mod-params';
import type { FxMod } from './fx-mod';

export { mixGains } from './fx-mod-params';

// smooths param changes, so mix, bypass and effect params don't click
export const setSmooth = (
  audioCtx: BaseAudioContext,
  param: AudioParam,
  value: number,
  timeConstant = 0.01
) => glideParam(param, value, audioCtx.currentTime, timeConstant);

export type FxSlot = ReturnType<typeof createFxSlot>;

// input → dry → output (mix: crossfade of dry and wet, mixGains; bypassed: only dry)
// input → send → core → wet → output (send is closed while inactive, so the core gets no new signal)
// a core with latency: input → dry delay (the latency) → dry, the same for bypass and mix, so the timing
// doesn't jump and the mix doesn't comb filter
// core → drain (muted) → destination: the core stays rendered while the slot is out of the chain, so its
// loops drain (a disconnected delay freezes its buffer and replays the old tail when added back).
// The routes of the mix move the gains by two lines of fx-mod (`mod`: the lines of the slot), the offsets of the
// mix moved from the knob; the gains stay at the knob with their glides
export const createFxSlot = (
  audioCtx: BaseAudioContext,
  core: FxCore,
  mod?: { fxMod: FxMod; dry: number; wet: number }
) => {
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

  // the mix knob, on (not bypassed and ready), the routes moving it
  let mix = { value: 0, on: false };
  let mixRoutes: FxRoute[] = [];
  // in the chain and not bypassed: the send is open
  let active = false;
  // [dry, wet] of the knob (bypassed: only dry)
  const gains = () => (mix.on ? mixGains(mix.value, linearMix) : [1, 0]);
  // the lines of the routes of the mix on the gains (while it is on)
  const follow = () => {
    if (!mod) return;
    const routed = mix.on && mixRoutes.length > 0;
    const line = (map: 'dry' | 'wet') =>
      routed
        ? { routes: mixRoutes, base: mix.value, map: linearMix ? (`${map}Linear` as const) : map }
        : null;
    mod.fxMod.set(mod.dry, line('dry'), [dry.gain]);
    mod.fxMod.set(mod.wet, line('wet'), [wet.gain]);
  };
  // the crossfade of mixGains: both gains glide alike, so a linear one keeps their sum
  const applyMix = () => {
    const [dryGain, wetGain] = gains();
    setGain(dry, dryGain);
    setGain(wet, wetGain);
    follow();
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
    // the LFOs of the last note (the core runs them)
    setLfos: (state: LfosState) => core.setLfos?.(state),
    // the routes of the envelopes and the LFOs of the last note: the mix moves the gains of the slot, the others
    // the core (with the routes of the note to the knobs of the LFOs)
    setModulation: (modulation: FxModulation | null) => {
      const routes = modulation?.routes ?? [];
      const next = routes.filter(({ param }) => param === 'mix');
      if (next.length > 0 || mixRoutes.length > 0) {
        mixRoutes = next;
        follow();
      }
      const own = routes.filter(({ param }) => param !== 'mix');
      const moved = own.some(({ param }) => !/^lfo[1-4]\./.test(param));
      core.setModulation(modulation && moved ? { note: modulation.note, routes: own } : null);
    },
    // active: in the chain and not bypassed
    setActive: (value: boolean) => {
      active = value;
      setGain(send, value ? 1 : 0);
      core.setActive(value);
    },
    // a preset switch, the output muted: the core forgets its tail, the gains are at the knobs at once (from
    // those of the preset before they would glide into its first notes); a mix its routes move follows them
    clear: () => {
      core.clear?.();
      const now = audioCtx.currentTime;
      const set = (node: GainNode, value: number) => {
        node.gain.cancelScheduledValues(now);
        setParam(node.gain, value, now);
      };
      set(send, active ? 1 : 0);
      const [dryGain, wetGain] = gains();
      set(dry, dryGain);
      set(wet, wetGain);
    },
    destroy: () => {
      core.destroy();
      [input, output, dry, wet, send, drain, dryDelay].forEach((node) => node?.disconnect());
    },
  };
};
