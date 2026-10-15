import { parseWav } from './wav';

const WAVE_SIZE = 2048;

export type LoadWavetable = (id: string) => Promise<number[][]>;

// the leaf of a wavetable path (the cascade value of a file) is its S3 key
export const wavetableId = (path: (string | number)[]) =>
  path.length > 0 ? String(path[path.length - 1]) : '';

const fetchOk = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return res;
};

// every wave is one cycle of WAVE_SIZE samples in the file, whatever its sample rate: the samples are read
// from the file, decodeAudioData would resample them to the context rate (44.1 → 48 kHz: 1.09 cycles a wave)
const fetchWavetable: LoadWavetable = async (id) => {
  const res = await fetchOk(`/.netlify/functions/get-wavetable?id=${encodeURIComponent(id)}`);
  const file = await fetchOk(await res.text());
  const { samples } = parseWav(await file.arrayBuffer());
  const wavesCount = Math.floor(samples.length / WAVE_SIZE);
  if (wavesCount === 0) throw new Error(`${id} is shorter than one wave`);
  const wavetable = [];
  for (let i = 0; i < wavesCount; i++)
    wavetable.push([...samples.subarray(i * WAVE_SIZE, (i + 1) * WAVE_SIZE)]);
  return wavetable;
};

// shared by both oscillators for the whole session; a failed load is dropped, so the next one retries
const cache = new Map<string, Promise<number[][]>>();

export const loadWavetable: LoadWavetable = (id) => {
  const cached = cache.get(id);
  if (cached) return cached;
  const promise = fetchWavetable(id);
  cache.set(id, promise);
  promise.catch(() => cache.delete(id));
  return promise;
};
