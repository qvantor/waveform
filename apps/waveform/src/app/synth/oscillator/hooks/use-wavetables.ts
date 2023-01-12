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

const wavetablesToOptions = (data: Element[]): CascadeOption[] =>
  data.map((wave) => {
    if ('Key' in wave) {
      const path = wave.Key.split('/');
      const [filename] = path[path.length - 1].split('.');
      return { value: wave.Key, label: `${filename} (${prettyBytes(wave.Size)})` };
    }
    return { value: wave.name, label: wave.name, children: wavetablesToOptions(wave.children) };
  });

export const useWavetables = () => {
  const { data } = useQuery<Element[]>({
    queryKey: ['wavetables'],
    queryFn: () => fetch('/.netlify/functions/get-wavetables-list').then((res) => res.json()),
    staleTime: 24 * 60 * 60 * 1000,
  });
  return wavetablesToOptions(data ?? []);
};
