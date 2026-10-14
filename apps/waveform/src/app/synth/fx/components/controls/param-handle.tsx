import React from 'react';
import { Fader, Handle } from '@waveform/ui-kit';
import { FxParamDef } from '../../effects/types';

interface Props {
  def: FxParamDef;
  value: number;
  onChange: (value: number) => void;
  disabled: boolean;
}

// a knob, or a fader when the param asks for one
export const ParamHandle = ({
  def: { label, min, max, mode, precision, formatValue, fillFrom, control },
  ...props
}: Props) => {
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
      {...props}
    />
  );
};
