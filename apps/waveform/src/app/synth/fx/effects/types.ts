import type { HandleProps } from '@waveform/ui-kit';
import type { ParamRange } from '@waveform/preset-schema';

export type FxParamDef = Pick<HandleProps, 'mode' | 'precision' | 'formatValue' | 'fillFrom'> &
  ParamRange & {
    label: string;
    // a switch instead of a knob, the value is the index of the option
    options?: { id: string; label: string }[];
    // a vertical fader instead of a knob
    control?: 'fader';
  };

// the effect itself (the wet signal), mix and bypass are added around it by createFxSlot
export interface FxCore {
  input: AudioNode;
  output: AudioNode;
  setParam: (key: string, value: number) => void;
  // removed from the chain or bypassed: internal loops must die out, so a stale tail doesn't come back
  setActive: (active: boolean) => void;
  destroy: () => void;
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
