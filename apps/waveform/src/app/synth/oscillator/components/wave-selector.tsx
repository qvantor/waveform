import React from 'react';
import { CascadeOption, CascadeSelect } from '@waveform/ui-kit';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { useWavetables, useOscillatorContext } from '../hooks';

export const WaveSelector = () => {
  const wavetables = useWavetables();
  const [{ $waveTablePath, $waveTableLoading }, { setWaveTablePath }] = useOscillatorContext();
  const waveTablePath = useBehaviorSubject($waveTablePath);
  const loading = useBehaviorSubject($waveTableLoading);
  const label = React.useMemo(() => {
    const { values } = waveTablePath.reduce<{ options?: CascadeOption[]; values: CascadeOption[] }>(
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
    if (values.length === 0) return 'Loading...';
    return values[values.length - 1].label;
  }, [waveTablePath, wavetables]);

  return (
    <CascadeSelect options={wavetables} value={waveTablePath} setValue={setWaveTablePath} loading={loading}>
      {label}
    </CascadeSelect>
  );
};
