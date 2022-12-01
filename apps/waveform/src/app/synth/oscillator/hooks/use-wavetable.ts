import { useQuery } from '@tanstack/react-query';
import React from 'react';
import { useSynthCore } from '../../common/modules';
import { useOscillatorContext } from './use-oscillator-context';

const WAVESIZE = 2048;

export const useWavetable = (id: string | null) => {
  const [, { setWaveTable }] = useOscillatorContext();
  const [{ audioCtx }] = useSynthCore();
  const { data } = useQuery({
    queryKey: ['wavetable', id],
    queryFn: async () => {
      const formLink = await fetch(`http://localhost:8888/.netlify/functions/get-wavetable?id=${id}`).then(
        (res) => res.text()
      );
      return await fetch(formLink).then(async (res) => {
        const buffer = await res.arrayBuffer();
        const audioBuffer = await audioCtx.decodeAudioData(buffer);
        if (audioBuffer.length % WAVESIZE !== 0) throw new Error('sample format is invalid');
        const data = audioBuffer.getChannelData(0);
        const wavesCount = audioBuffer.length / WAVESIZE;
        const wavetable = [];
        for (let i = 0; i < wavesCount; i++)
          wavetable.push([...data.slice(i * WAVESIZE, (i + 1) * WAVESIZE)]);
        return wavetable;
      });
    },
    enabled: Boolean(id),
    staleTime: 24 * 60 * 60 * 1000,
    cacheTime: Infinity,
  });
  React.useEffect(() => {
    if (data) setWaveTable(data);
  }, [data]);
  return data;
};