import { finiteSamples, parseWav, Wav } from './wav';

// a compressed file doesn't tell its rate before it is decoded: most are 44.1 kHz, and a fixed rate gives
// the same samples on any device
const DECODE_RATE = 44100;

// the samples of an audio file at its own rate, not at the rate of the audio context (decodeAudioData there
// stretches a 44.1 kHz wavetable to 1.09 cycles in a 2048-sample wave at 48 kHz): a WAV as stored, other
// formats decoded at DECODE_RATE; a sample that is not finite as 0
export const readAudioFile = async (buffer: ArrayBuffer): Promise<Wav> => {
  try {
    const { sampleRate, samples } = parseWav(buffer);
    return { sampleRate, samples };
  } catch {
    // not a WAV, or one the parser doesn't read
    const audioBuffer = await new OfflineAudioContext(1, 1, DECODE_RATE).decodeAudioData(buffer);
    return { sampleRate: audioBuffer.sampleRate, samples: finiteSamples(audioBuffer.getChannelData(0)) };
  }
};
