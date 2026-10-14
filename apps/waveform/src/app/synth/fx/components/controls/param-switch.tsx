import React from 'react';
import { ModeSwitch } from '@waveform/ui-kit';
import { FxParamDef } from '../../effects/types';

interface Props {
  def: FxParamDef;
  // by option id
  icons: Record<string, React.ReactNode>;
  value: number;
  onChange: (value: number) => void;
  disabled: boolean;
}

// a switch over the options of the param, the value is the index of the option
export const ParamSwitch = ({ def: { options }, icons, value, onChange, disabled }: Props) => {
  const items = React.useMemo(
    () => (options ?? []).map(({ id, label }) => ({ id, label, icon: icons[id] })),
    [options, icons]
  );
  return (
    <ModeSwitch
      options={items}
      value={items[Math.round(value)]?.id ?? items[0]?.id}
      onChange={(id) => onChange(items.findIndex((option) => option.id === id))}
      disabled={disabled}
    />
  );
};
