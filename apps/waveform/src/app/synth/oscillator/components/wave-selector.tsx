import React from 'react';
import { CascadeOption, CascadeSelect } from '@waveform/ui-kit';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { useWavetables, useOscillatorContext, skipSingleFolders } from '../hooks';

export const WaveSelector = () => {
  const wavetables = useWavetables();
  const [{ $waveTablePath, $waveTableLoading }, { setWaveTablePath }] = useOscillatorContext();
  const waveTablePath = useBehaviorSubject($waveTablePath);
  const loading = useBehaviorSubject($waveTableLoading);
  // the only pack (ESW Core Tables) is not a column: folders, then files
  const { prefix, options } = React.useMemo(() => skipSingleFolders(wavetables), [wavetables]);
  const value = prefix.every((key, i) => waveTablePath[i] === key)
    ? waveTablePath.slice(prefix.length)
    : waveTablePath;
  const setValue = (path: (string | number)[]) => setWaveTablePath([...prefix, ...path]);
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
    <CascadeSelect options={options} value={value} setValue={setValue} loading={loading}>
      {label}
    </CascadeSelect>
  );
};
