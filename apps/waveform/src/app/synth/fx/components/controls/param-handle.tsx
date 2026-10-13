import React from 'react';
import { Handle } from '@waveform/ui-kit';
import { FxParamDef } from '../../effects/types';

interface Props {
  def: FxParamDef;
  value: number;
  onChange: (value: number) => void;
  disabled: boolean;
}

export const ParamHandle = ({
  def: { label, min, max, mode, precision, formatValue, fillFrom },
  ...props
}: Props) => (
  <Handle
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
