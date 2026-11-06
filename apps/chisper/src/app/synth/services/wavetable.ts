import { WAVETABLES_ORIGIN, WAVETABLES_PROXY } from './buckets';
import { bucketLoader } from './fetch';
import { sharedLoads } from './shared-loads';
import { parseWav } from './wav';

const WAVE_SIZE = 2048;

// the frames of a table file and its morph mark (a table with one plays expanded to 256 frames)
export interface Wavetable {
  frames: number[][];
  morph: boolean;
}

// (`signal`: the caller gives it up, sharedLoads)
export type LoadWavetable = (id: string, signal?: AbortSignal) => Promise<Wavetable>;

// the leaf of a wavetable path (the cascade value of a file) is its key in the bucket
export const wavetableId = (path: (string | number)[]) =>
  path.length > 0 ? String(path[path.length - 1]) : '';

const loadFile = bucketLoader(WAVETABLES_ORIGIN, WAVETABLES_PROXY);

// the file from the domain of the bucket (else through the site); every wave is one cycle of WAVE_SIZE samples in
// it (or of the size of its mark), whatever its sample rate: the samples are read from the file, decodeAudioData
// would resample them to the context rate (44.1 → 48 kHz: 1.09 cycles a wave)
const fetchWavetable = (id: string, signal: AbortSignal) =>
  loadFile(
    id,
    (bytes): Wavetable => {
      const { samples, mark } = parseWav(bytes);
      const size = mark?.frameSize || WAVE_SIZE;
      const wavesCount = Math.floor(samples.length / size);
      if (wavesCount === 0) throw new Error(`${id} is shorter than one wave`);
      const frames = [];
      for (let i = 0; i < wavesCount; i++) frames.push([...samples.subarray(i * size, (i + 1) * size)]);
      return { frames, morph: mark?.morph ?? false };
    },
    signal
  );

// shared by both oscillators for the whole session
export const loadWavetable: LoadWavetable = sharedLoads(fetchWavetable);
