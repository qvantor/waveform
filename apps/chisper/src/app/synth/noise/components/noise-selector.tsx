import React from 'react';
import { CascadeOption, CascadeSelect } from '@chisper/ui-kit';
import { useBehaviorSubject } from '@chisper/rxjs-react';
import { useNoise } from '../../common/modules';
import { sampleName, useNoiseSamples } from '../hooks/use-noise-samples';

// the label of the option at the end of `path` (folders, then the key of a sample); a path the list hasn't (the
// list not loaded yet, a sample gone from it): the name of its sample
export const pathLabel = (options: CascadeOption[], path: (string | number)[]): React.ReactNode => {
  let level: CascadeOption[] | undefined = options;
  let found: CascadeOption | undefined;
  for (const key of path) {
    found = level?.find((option) => option.value === key);
    level = found && 'children' in found ? found.children : undefined;
  }
  if (found && !('children' in found)) return found.label;
  const key = path[path.length - 1];
  return key === undefined ? '' : sampleName(String(key));
};

// the sample of the noise, by category; ◀ ▶ through all of them
export const NoiseSelector = () => {
  const samples = useNoiseSamples();
  const [{ $samplePath, $sampleLoading }, { setSamplePath }] = useNoise();
  const path = useBehaviorSubject($samplePath);
  const loading = useBehaviorSubject($sampleLoading);
  return (
    <CascadeSelect options={samples} value={path} setValue={setSamplePath} loading={loading}>
      {pathLabel(samples, path)}
    </CascadeSelect>
  );
};
