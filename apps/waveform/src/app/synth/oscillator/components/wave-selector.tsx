import React from 'react';
import { CascadeOption, CascadeSelect } from '@waveform/ui-kit';
import { useWavetables, useWavetable } from '../hooks';

export const WaveSelector = () => {
  const wavetables = useWavetables();
  const [keys, setKeys] = React.useState<(string | number)[]>([
    'Echo Sound Works Core Tables',
    'Basics',
    'ESW Core Tables/Basics/ESW Basics - Saw Collection.wav',
  ]);
  const { label, value } = React.useMemo(() => {
    const { values } = keys.reduce<{ options?: CascadeOption[]; values: CascadeOption[] }>(
      (sum, key) => {
        if (!sum.options) return sum;
        const value = sum.options.find((option) => option.value === key);
        if (!value) return sum;
        return {
          values: [...sum.values, value],
          options: 'children' in value ? value.children : undefined,
        };
      },
      {
        options: wavetables,
        values: [],
      }
    );
    if (values.length === 0) return { label: 'Loading...', value: null };
    return values[values.length - 1];
  }, [keys, wavetables]);

  useWavetable(value);
  return (
    <CascadeSelect options={wavetables} value={keys} setValue={setKeys}>
      {label}
    </CascadeSelect>
  );
};
