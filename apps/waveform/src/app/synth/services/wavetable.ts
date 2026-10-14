const WAVE_SIZE = 2048;

export type LoadWavetable = (
  audioCtx: Pick<BaseAudioContext, 'decodeAudioData'>,
  id: string
) => Promise<number[][]>;

// the leaf of a wavetable path (the cascade value of a file) is its S3 key
export const wavetableId = (path: (string | number)[]) =>
  path.length > 0 ? String(path[path.length - 1]) : '';

const fetchOk = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return res;
};

const fetchWavetable: LoadWavetable = async (audioCtx, id) => {
  const res = await fetchOk(`/.netlify/functions/get-wavetable?id=${encodeURIComponent(id)}`);
  const file = await fetchOk(await res.text());
  const audioBuffer = await audioCtx.decodeAudioData(await file.arrayBuffer());
  const data = audioBuffer.getChannelData(0);
  const wavesCount = Math.floor(audioBuffer.length / WAVE_SIZE);
  const wavetable = [];
  for (let i = 0; i < wavesCount; i++) wavetable.push([...data.slice(i * WAVE_SIZE, (i + 1) * WAVE_SIZE)]);
  return wavetable;
};

// shared by both oscillators for the whole session; a failed load is dropped, so the next one retries
const cache = new Map<string, Promise<number[][]>>();

export const loadWavetable: LoadWavetable = (audioCtx, id) => {
  const cached = cache.get(id);
  if (cached) return cached;
  const promise = fetchWavetable(audioCtx, id);
  cache.set(id, promise);
  promise.catch(() => cache.delete(id));
  return promise;
};
