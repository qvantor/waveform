import { FX_MIX_PARAM, FxType } from '@waveform/preset-schema';
import { number } from '@waveform/math';
import { FxDefinition, FxParamDef } from './types';
import { delay } from './delay';

export const FX_REGISTRY: Record<FxType, FxDefinition> = { delay };

// common for every effect, applied by createFxSlot
export const MIX_PARAM: FxParamDef = {
  ...FX_MIX_PARAM,
  label: 'Mix',
  precision: 100,
  formatValue: number.percent,
};

export { createFxSlot } from './create-fx-slot';
export type { FxSlot } from './create-fx-slot';
