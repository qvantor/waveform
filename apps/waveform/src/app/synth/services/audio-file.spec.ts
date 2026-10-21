import { ascii, data, fmt, PCM, riff, wavetableFile } from '../../../test-utils/wav-file';
import { readAudioFile } from './audio-file';

const decoded = Float32Array.from([0.5, -0.5, 0.25]);
const decodeAudioData = jest.fn((_buffer: ArrayBuffer) =>
  Promise.resolve({ sampleRate: 44100, getChannelData: () => decoded })
);
const OfflineAudioContextMock = jest.fn((_channels: number, _length: number, _sampleRate: number) => ({
  decodeAudioData,
}));

beforeEach(() => {
  decodeAudioData.mockClear();
  OfflineAudioContextMock.mockClear();
  Object.assign(globalThis, { OfflineAudioContext: OfflineAudioContextMock });
});

afterAll(() => {
  Reflect.deleteProperty(globalThis, 'OfflineAudioContext');
});

describe('readAudioFile', () => {
  // decodeAudioData on the live context resampled a 44.1 kHz wavetable to 48 kHz: 1.09 cycles a wave
  it('reads a WAV as stored, at its own rate, without decoding it', async () => {
    const samples = Float32Array.from([0, 0.25, -0.5, 1, -1, 0.125]);

    expect(await readAudioFile(wavetableFile(samples, 44100))).toEqual({ sampleRate: 44100, samples });
    expect(await readAudioFile(wavetableFile(samples, 48000))).toEqual({ sampleRate: 48000, samples });
    expect(OfflineAudioContextMock).not.toHaveBeenCalled();
  });

  it('takes the first channel of a stereo WAV', async () => {
    const file = riff(
      fmt({ format: PCM, bits: 16, channels: 2 }),
      data([0x4000, -0x8000, -0x4000, 0], { format: PCM, bits: 16 })
    );

    expect(await readAudioFile(file)).toEqual({ sampleRate: 44100, samples: Float32Array.from([0.5, -0.5]) });
  });

  it('decodes other formats at 44.1 kHz, whatever the rate of the audio context', async () => {
    const file = ascii('OggS vorbis').buffer;

    expect(await readAudioFile(file)).toEqual({ sampleRate: 44100, samples: decoded });
    expect(OfflineAudioContextMock).toHaveBeenCalledWith(1, 1, 44100);
    expect(decodeAudioData).toHaveBeenCalledWith(file);
  });

  it('decodes a WAV the parser does not read', async () => {
    // 4 bit ADPCM
    const file = riff(fmt({ format: 2, bits: 4 }), data([1, 2, 3, 4]));

    expect(await readAudioFile(file)).toEqual({ sampleRate: 44100, samples: decoded });
    expect(decodeAudioData).toHaveBeenCalledWith(file);
  });

  it('decodes the samples that are not finite as 0', async () => {
    decodeAudioData.mockResolvedValueOnce({
      sampleRate: 44100,
      getChannelData: () => Float32Array.from([0.5, NaN, Infinity, -Infinity, -0.5]),
    });

    expect((await readAudioFile(ascii('OggS vorbis').buffer)).samples).toEqual(
      Float32Array.from([0.5, 0, 0, 0, -0.5])
    );
  });

  it('fails when the file cannot be decoded', async () => {
    decodeAudioData.mockRejectedValueOnce(new Error('Unable to decode audio data'));

    await expect(readAudioFile(ascii('text').buffer)).rejects.toThrow('Unable to decode audio data');
  });
});
