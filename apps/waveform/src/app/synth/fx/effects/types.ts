import type { BehaviorSubject } from 'rxjs';
import type { HandleProps } from '@waveform/ui-kit';
import type { ParamRange } from '@waveform/preset-schema';
import type { FxModulation } from './fx-modulation';

export type FxParamDef = Pick<HandleProps, 'name' | 'mode' | 'precision' | 'formatValue' | 'fillFrom'> &
  ParamRange & {
    label: string;
    // a switch instead of a knob, the value is the index of the option
    options?: { id: string; label: string }[];
    // a vertical fader instead of a knob
    control?: 'fader';
  };

// loading: the worklet module is being added; unsupported: no AudioWorklet in this browser or context
// (old Safari, http on a LAN IP); failed: the module or the node failed, retry() loads it again
export type FxStatus = 'loading' | 'ready' | 'unsupported' | 'failed';

// a loading effect is already in the chain (it passes the dry signal until its node exists), an unavailable
// one is not
export const isFxUsable = (status: FxStatus) => status === 'loading' || status === 'ready';

// the effect itself (the wet signal), mix and bypass are added around it by createFxSlot
export interface FxCore {
  input: AudioNode;
  output: AudioNode;
  setParam: (key: string, value: number) => void;
  // removed from the chain or bypassed: internal loops must die out, so a stale tail doesn't come back
  setActive: (active: boolean) => void;
  // the tail is forgotten at once, its loops and lines start empty (a preset switch, the output muted);
  // absent: it has none
  clear?: () => void;
  // its knobs follow the envelopes of the last note (fx-modulation.ts); null: they are at their own values
  setModulation: (mod: FxModulation | null) => void;
  destroy: () => void;
  // effects loaded asynchronously (audio worklets, see createWorkletFx), absent: always ready
  $status?: BehaviorSubject<FxStatus>;
  // loads a failed effect again
  retry?: () => void;
  // seconds the output lags the input (linear phase oversampling), createFxSlot delays the dry signal as
  // much, so the mix doesn't comb filter; absent: no latency
  latency?: number;
  // the wet signal is the dry one reshaped, in time with it (a distortion): they add up like one sound, so
  // the mix is linear, an equal-power crossfade would be up to 3 dB louder in between; absent: equal power
  // (echoes and reverb add up like unrelated sounds)
  linearMix?: boolean;
}

// a built-in preset of the effect: sets mix and every param, added/on/order are not touched
export interface FxPreset<K extends string = string> {
  id: string;
  name: string;
  mix: number;
  params: Record<K, number>;
}

export interface FxDefinition<K extends string = string> {
  label: string;
  // param keys are the preset snapshot keys of the effect
  params: Record<K, FxParamDef>;
  presets: FxPreset<K>[];
  create: (audioCtx: BaseAudioContext) => FxCore;
}
