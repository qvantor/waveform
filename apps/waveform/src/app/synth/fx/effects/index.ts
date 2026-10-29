import { mapValues } from 'lodash';
import { FX_MIX_PARAMS, FxType } from '@waveform/preset-schema';
import { number } from '@waveform/math';
import { FxDefinition, FxParamDef, FxPreset } from './types';
import { distortion } from './distortion';
import { delay } from './delay';
import { reverb } from './reverb';

export const FX_REGISTRY: Record<FxType, FxDefinition> = { distortion, delay, reverb };

// the mix of each effect, applied by createFxSlot: the same knob, the default of the effect (the distortion all wet)
export const MIX_PARAMS: Record<FxType, FxParamDef> = mapValues(FX_MIX_PARAMS, (mix) => ({
  ...mix,
  label: 'Mix',
  name: 'Dry/wet',
  precision: 100,
  formatValue: number.percent,
}));

// the built-in preset the current mix and params match exactly, none: a custom sound
export const findFxPreset = (type: FxType, { mix, params }: Pick<FxPreset, 'mix' | 'params'>) => {
  const keys = Object.keys(FX_REGISTRY[type].params);
  return FX_REGISTRY[type].presets.find(
    (preset) => preset.mix === mix && keys.every((key) => preset.params[key] === params[key])
  );
};

export { createFxSlot } from './create-fx-slot';
export type { FxSlot } from './create-fx-slot';
export { isFxUsable } from './types';
export type { FxStatus } from './types';
