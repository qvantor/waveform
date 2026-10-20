import { mapValues } from 'lodash';
import type { ParamRange } from '@waveform/preset-schema';
import { FxCore } from './types';
import { setSmooth } from './create-fx-slot';
import { setParam } from './fx-automation';

// param values of an effect core, from the defaults. Until bind they are set instantly: a ramp from
// the node defaults (gain 1, delayTime 0) would briefly run the feedback loops above unity
export const createFxParams = <K extends string>(
  audioCtx: BaseAudioContext,
  params: Record<K, ParamRange>
) => {
  const values: Record<K, number> = mapValues(params, (param) => param.default);
  let smooth = false;

  const setValue = (param: AudioParam, value: number, timeConstant?: number) =>
    smooth ? setSmooth(audioCtx, param, value, timeConstant) : setParam(param, value, audioCtx.currentTime);

  // applies every value, then smooths the changes; unknown keys are ignored
  const bind = (apply: Record<K, (value: number) => void>): FxCore['setParam'] => {
    (Object.keys(values) as K[]).forEach((key) => apply[key](values[key]));
    smooth = true;
    return (key, value) => {
      if (!(key in apply)) return;
      values[key as K] = value;
      apply[key as K](value);
    };
  };

  return { values, setValue, bind };
};
