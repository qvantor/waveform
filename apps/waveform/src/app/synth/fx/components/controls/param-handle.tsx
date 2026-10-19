import React from 'react';
import { Fader, Handle } from '@waveform/ui-kit';
import { FxParamDef } from '../../effects/types';
import { useKnobModulation } from '../../../modulation/use-knob-modulation';

interface Props {
  def: FxParamDef;
  value: number;
  onChange: (value: number) => void;
  disabled: boolean;
  // its modulation target (delay.time): the ENV tabs are dropped onto it, its routes show on it
  target?: string;
}

// a knob, or a fader when the param asks for one
export const ParamHandle = ({
  def: { label, min, max, mode, precision, formatValue, fillFrom, control },
  target = '',
  ...props
}: Props) => {
  const modulation = useKnobModulation(target);
  const Control = control === 'fader' ? Fader : Handle;
  return (
    <Control
      label={label}
      min={min}
      max={max}
      mode={mode}
      precision={precision}
      formatValue={formatValue}
      fillFrom={fillFrom}
      {...modulation}
      {...props}
    />
  );
};
