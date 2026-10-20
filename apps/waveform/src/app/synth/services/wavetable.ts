import { parseWav } from './wav';

const WAVE_SIZE = 2048;

// the frames of a table file and its morph mark (a table with one plays expanded to 256 frames)
export interface Wavetable {
  frames: number[][];
  morph: boolean;
}

export type LoadWavetable = (id: string) => Promise<Wavetable>;

// the leaf of a wavetable path (the cascade value of a file) is its S3 key
export const wavetableId = (path: (string | number)[]) =>
  path.length > 0 ? String(path[path.length - 1]) : '';

const fetchOk = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return res;
};

// every wave is one cycle of WAVE_SIZE samples in the file (or of the size of its mark), whatever its sample
// rate: the samples are read from the file, decodeAudioData would resample them to the context rate (44.1 →
// 48 kHz: 1.09 cycles a wave)
const fetchWavetable: LoadWavetable = async (id) => {
  const res = await fetchOk(`/.netlify/functions/get-wavetable?id=${encodeURIComponent(id)}`);
  const file = await fetchOk(await res.text());
  const { samples, mark } = parseWav(await file.arrayBuffer());
  const size = mark?.frameSize || WAVE_SIZE;
  const wavesCount = Math.floor(samples.length / size);
  if (wavesCount === 0) throw new Error(`${id} is shorter than one wave`);
  const frames = [];
  for (let i = 0; i < wavesCount; i++) frames.push([...samples.subarray(i * size, (i + 1) * size)]);
  return { frames, morph: mark?.morph ?? false };
};

// shared by both oscillators for the whole session; a failed load is dropped, so the next one retries
const cache = new Map<string, Promise<Wavetable>>();

export const loadWavetable: LoadWavetable = (id) => {
  const cached = cache.get(id);
  if (cached) return cached;
  const promise = fetchWavetable(id);
  cache.set(id, promise);
  promise.catch(() => cache.delete(id));
  return promise;
};
