import { parseWavChannels } from './wav';

// a sample of the noise oscillator: its channels (one or two) at its own rate (the engine plays it at any rate of
// the context: the core steps through it by the ratio)
export interface NoiseSample {
  channels: Float32Array[];
  sampleRate: number;
}

export type LoadNoiseSample = (id: string) => Promise<NoiseSample>;

const fetchOk = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return res;
};

// its signed url from the function, then the file as stored (no resampling)
const fetchNoiseSample: LoadNoiseSample = async (id) => {
  const res = await fetchOk(`/.netlify/functions/get-noise?id=${encodeURIComponent(id)}`);
  const file = await fetchOk(await res.text());
  const { channels, sampleRate } = parseWavChannels(await file.arrayBuffer());
  if (channels.length === 0 || channels[0].length === 0) throw new Error(`${id} has no samples`);
  return { channels: channels.slice(0, 2), sampleRate };
};

// for the whole session; a failed load is dropped, so the next one retries
const cache = new Map<string, Promise<NoiseSample>>();

export const loadNoiseSample: LoadNoiseSample = (id) => {
  const cached = cache.get(id);
  if (cached) return cached;
  const promise = fetchNoiseSample(id);
  cache.set(id, promise);
  promise.catch(() => cache.delete(id));
  return promise;
};
