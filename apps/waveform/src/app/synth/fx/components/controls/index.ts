import React from 'react';
import { FxType } from '@waveform/preset-schema';
import { DelayControls } from './delay-controls';
import { ReverbControls } from './reverb-controls';
import { FxControlsProps } from './types';

// effect-specific layout of the params; the on/off switch is added by FxPanel, its Out (mix) group is put
// after the last group of the effect
export const FX_CONTROLS: Record<FxType, React.ComponentType<FxControlsProps>> = {
  delay: DelayControls,
  reverb: ReverbControls,
};

export { ParamHandle } from './param-handle';
export { ControlsFlow, ControlsGroup } from './group';
