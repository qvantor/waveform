import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { CascadeOption } from '@chisper/ui-kit';
import { fetchList } from '../../services/fetch';

// the list of netlify/functions/get-noises-list: the folders of the samples (their categories), a sample its key
interface Sample {
  Key: string;
  Size: number;
}
interface Folder {
  name: string;
  children: Element[];
}
type Element = Folder | Sample;

// the name of a sample: its file without the extension
export const sampleName = (key: string) => (key.split('/').pop() ?? key).replace(/\.[^.]+$/, '');

export const samplesToOptions = (data: Element[]): CascadeOption[] =>
  data.map((element) =>
    'Key' in element
      ? { value: element.Key, label: sampleName(element.Key) }
      : { value: element.name, label: element.name, children: samplesToOptions(element.children) }
  );

// the samples of the noise as the options of a cascade (a day stale: the list changes with an upload)
export const useNoiseSamples = () => {
  const { data } = useQuery<Element[]>({
    queryKey: ['noises'],
    queryFn: () => fetchList<Element>('/.netlify/functions/get-noises-list'),
    staleTime: 24 * 60 * 60 * 1000,
  });
  return React.useMemo(() => samplesToOptions(data ?? []), [data]);
};
