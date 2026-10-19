import React from 'react';
import { Fader, Handle } from '@waveform/ui-kit';
import { FxParamDef } from '../../effects/types';
import { KnobModulation, useKnobModulation } from '../../../modulation/use-knob-modulation';

interface Props {
  def: FxParamDef;
  value: number;
  onChange: (value: number) => void;
  disabled: boolean;
  // its modulation target (delay.time): the ENV tabs are dropped onto it, its routes show on it
  target?: string;
  // the modulation of the target when the controls have it already (useKnobModulation: a chart follows its routes)
  modulation?: KnobModulation;
}

const Control = ({
  def: { label, min, max, mode, precision, formatValue, fillFrom, control },
  modulation,
  ...props
}: Omit<Props, 'target'>) => {
  const Component = control === 'fader' ? Fader : Handle;
  return (
    <Component
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

const TargetControl = ({ target = '', ...props }: Props) => {
  const modulation = useKnobModulation(target);
  return <Control {...props} modulation={modulation} />;
};

// a knob, or a fader when the param asks for one
export const ParamHandle = ({ target, ...props }: Props) =>
  props.modulation ? <Control {...props} /> : <TargetControl target={target} {...props} />;
