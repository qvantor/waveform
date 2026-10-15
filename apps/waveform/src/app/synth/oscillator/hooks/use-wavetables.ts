import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { CascadeOption } from '@waveform/ui-kit';
import prettyBytes from 'pretty-bytes';

interface Wavetable {
  Key: string;
  Size: number;
}

type Element = Folder | Wavetable;

interface Folder {
  name: string;
  children: Element[];
}

export const wavetablesToOptions = (data: Element[]): CascadeOption[] =>
  data.map((wave) => {
    if ('Key' in wave) {
      const path = wave.Key.split('/');
      const [filename] = path[path.length - 1].split('.');
      return { value: wave.Key, label: `${filename} (${prettyBytes(wave.Size)})` };
    }
    return { value: wave.name, label: wave.name, children: wavetablesToOptions(wave.children) };
  });

// a folder alone on its level is chosen for the user (the only wavetable pack): the cascade starts inside it,
// the value of the model is still the whole path, prefix included
export const skipSingleFolders = (
  options: CascadeOption[],
  prefix: string[] = []
): { prefix: string[]; options: CascadeOption[] } => {
  const [single] = options;
  if (options.length !== 1 || !('children' in single)) return { prefix, options };
  return skipSingleFolders(single.children, [...prefix, single.value]);
};

export const useWavetables = () => {
  const { data } = useQuery<Element[]>({
    queryKey: ['wavetables'],
    queryFn: () => fetch('/.netlify/functions/get-wavetables-list').then((res) => res.json()),
    staleTime: 24 * 60 * 60 * 1000,
  });
  return React.useMemo(() => wavetablesToOptions(data ?? []), [data]);
};
