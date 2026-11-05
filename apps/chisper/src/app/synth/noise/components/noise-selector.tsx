import React from 'react';
import { CascadeSelect } from '@chisper/ui-kit';
import { useBehaviorSubject } from '@chisper/rxjs-react';
import { useNoise } from '../../common/modules';
import { sampleName, useNoiseSamples } from '../hooks/use-noise-samples';

// the label of a path (folders, then the key of a sample): the name of its sample, as its option has it, also where
// the list hasn't it (not loaded yet, a sample gone from it)
export const pathLabel = (path: (string | number)[]): string => {
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
    <CascadeSelect
      options={samples}
      value={path}
      setValue={setSamplePath}
      loading={loading}
      label={pathLabel(path)}
    />
  );
};
