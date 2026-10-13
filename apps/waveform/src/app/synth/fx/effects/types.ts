import type { HandleProps } from '@waveform/ui-kit';
import type { ParamRange } from '@waveform/preset-schema';

export type FxParamDef = Pick<HandleProps, 'mode' | 'precision' | 'formatValue'> &
  ParamRange & {
    label: string;
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

export interface FxDefinition<K extends string = string> {
  label: string;
  // param keys are the preset snapshot keys of the effect
  params: Record<K, FxParamDef>;
  create: (audioCtx: BaseAudioContext) => FxCore;
}
