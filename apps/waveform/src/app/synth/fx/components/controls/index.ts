import React from 'react';
import { FxType } from '@waveform/preset-schema';
import { DelayControls } from './delay-controls';
import { FxControlsProps } from './types';

// effect-specific layout of the params, mix and the on/off switch are added by FxPanel
export const FX_CONTROLS: Record<FxType, React.ComponentType<FxControlsProps>> = { delay: DelayControls };

export { ParamHandle } from './param-handle';
export { ControlsGroup } from './group';
