import { useQuery } from '@tanstack/react-query';
import React from 'react';
import { useSynthCore } from '../../common/modules';
import { useOscillatorContext } from './use-oscillator-context';

const WAVE_SIZE = 2048;

export const useWavetable = (id: string | null) => {
  const [, { setWaveTable }] = useOscillatorContext();
  const [{ audioCtx }] = useSynthCore();
  const { data, isLoading } = useQuery({
    queryKey: ['wavetable', id],
    queryFn: async () => {
      const formLink = await fetch(`/.netlify/functions/get-wavetable?id=${id}`).then((res) => res.text());
      return await fetch(formLink).then(async (res) => {
        const buffer = await res.arrayBuffer();
        const audioBuffer = await audioCtx.decodeAudioData(buffer);
        const data = audioBuffer.getChannelData(0);
        const wavesCount = Math.floor(audioBuffer.length / WAVE_SIZE);
        const wavetable = [];
        for (let i = 0; i < wavesCount; i++)
          wavetable.push([...data.slice(i * WAVE_SIZE, (i + 1) * WAVE_SIZE)]);
        return wavetable;
      });
    },
    enabled: Boolean(id),
    staleTime: 24 * 60 * 60 * 1000,
    cacheTime: Infinity,
  });
  React.useEffect(() => {
    if (data) setWaveTable(data);
  }, [data, setWaveTable]);
  return isLoading;
};
