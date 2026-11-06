import { NOISES_ORIGIN, NOISES_PROXY } from './buckets';
import { bucketLoader } from './fetch';
import { sharedLoads } from './shared-loads';
import { parseWavChannels } from './wav';

// a sample of the noise oscillator: its channels (one or two) at its own rate (the engine plays it at any rate of
// the context: the core steps through it by the ratio)
export interface NoiseSample {
  channels: Float32Array[];
  sampleRate: number;
}

// (`signal`: the caller gives it up, sharedLoads)
export type LoadNoiseSample = (id: string, signal?: AbortSignal) => Promise<NoiseSample>;

const loadFile = bucketLoader(NOISES_ORIGIN, NOISES_PROXY);

// the file from the domain of the bucket (else through the site), as stored (no resampling)
const fetchNoiseSample = (id: string, signal: AbortSignal) =>
  loadFile(
    id,
    (bytes): NoiseSample => {
      const { channels, sampleRate } = parseWavChannels(bytes);
      if (channels.length === 0 || channels[0].length === 0) throw new Error(`${id} has no samples`);
      return { channels: channels.slice(0, 2), sampleRate };
    },
    signal
  );

// for the whole session
export const loadNoiseSample: LoadNoiseSample = sharedLoads(fetchNoiseSample);
