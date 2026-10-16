import { mapValues } from 'lodash';
import { FX_MIX_PARAMS, FX_PARAMS } from '@waveform/preset-schema';
import { FxPreset } from './types';

export type DistortionParam = keyof typeof FX_PARAMS.distortion;

const SOFT = 0;
const HARD = 1;

// the makeup gain keeps the loudness of a note at every drive: level 0 is about as loud as the dry sound, at
// any mix (the distortion is mixed linearly)
export const DISTORTION_PRESETS: FxPreset<DistortionParam>[] = [
  // the schema defaults, the state of a freshly added effect
  {
    id: 'default',
    name: 'Default',
    mix: FX_MIX_PARAMS.distortion.default,
    params: mapValues(FX_PARAMS.distortion, (param) => param.default),
  },
  // a touch of saturation under the clean sound
  { id: 'warm', name: 'Warm', mix: 0.5, params: { mode: SOFT, drive: 6, tone: 12000, level: 0 } },
  { id: 'overdrive', name: 'Overdrive', mix: 1, params: { mode: SOFT, drive: 18, tone: 6000, level: 0 } },
  { id: 'crunch', name: 'Crunch', mix: 1, params: { mode: HARD, drive: 12, tone: 8000, level: 0 } },
  { id: 'fuzz', name: 'Fuzz', mix: 1, params: { mode: HARD, drive: 18, tone: 3500, level: 0 } },
  // the clean sound with a hard edge mixed in, a little hotter so it is heard under the dry one
  {
    id: 'parallel-grit',
    name: 'Parallel grit',
    mix: 0.3,
    params: { mode: HARD, drive: 18, tone: 10000, level: 3 },
  },
  // dark and squashed, like a small speaker
  { id: 'lo-fi', name: 'Lo-fi', mix: 1, params: { mode: SOFT, drive: 18, tone: 2500, level: 0 } },
];
