import {
  ascii,
  chunk,
  data,
  encode,
  FLOAT,
  fmt,
  PCM,
  riff,
  wavetableFile,
} from '../../../test-utils/wav-file';
import { parseWav } from './wav';

const floats = (...values: number[]) => Float32Array.from(values);

describe('parseWav', () => {
  it('reads a wavetable file (JUNK, fmt, clm, data) as stored', () => {
    const samples = floats(0, 0.25, -0.5, 1, -1, 0.125);

    expect(parseWav(wavetableFile(samples))).toEqual({ sampleRate: 44100, samples });
  });

  it('does not resample: the same samples at any sample rate', () => {
    const samples = floats(0, 0.25, -0.5, 1, -1, 0.125);

    const at48k = parseWav(wavetableFile(samples, 48000));

    expect(at48k.sampleRate).toBe(48000);
    expect(at48k.samples).toEqual(samples);
  });

  it.each([
    [8, [0, 128, 192, 255], [-1, 0, 0.5, 127 / 128]],
    [16, [-0x8000, 0, 0x4000, 0x7fff], [-1, 0, 0.5, 0x7fff / 0x8000]],
    [24, [-0x800000, -1, 0x400000, 0x7fffff], [-1, -1 / 0x800000, 0.5, 0x7fffff / 0x800000]],
    [32, [-0x80000000, -1, 0x40000000, 0x7fffffff], [-1, -1 / 0x80000000, 0.5, 0x7fffffff / 0x80000000]],
  ])('scales %i bit PCM to -1..1', (bits, stored, expected) => {
    const wav = parseWav(riff(fmt({ format: PCM, bits }), data(stored, { format: PCM, bits })));

    expect(wav.samples).toEqual(floats(...expected));
  });

  it('reads 64 bit floats', () => {
    const wav = parseWav(riff(fmt({ bits: 64 }), data([0.1, -0.75], { format: FLOAT, bits: 64 })));

    expect(wav.samples).toEqual(floats(0.1, -0.75));
  });

  it('takes the format of WAVE_FORMAT_EXTENSIBLE from its sub-format', () => {
    const float = parseWav(riff(fmt({ extensible: true }), data([0.5, -0.25])));
    const pcm = parseWav(
      riff(fmt({ format: PCM, bits: 16, extensible: true }), data([0x4000], { format: PCM, bits: 16 }))
    );

    expect(float.samples).toEqual(floats(0.5, -0.25));
    expect(pcm.samples).toEqual(floats(0.5));
  });

  it('keeps the first channel', () => {
    const wav = parseWav(riff(fmt({ channels: 2 }), data([0.5, -1, 0.25, -1, -0.5, -1])));

    expect(wav.samples).toEqual(floats(0.5, 0.25, -0.5));
  });

  it('skips unknown chunks, also odd-sized ones with their pad byte', () => {
    const wav = parseWav(
      riff(chunk('LIST', new Uint8Array(3)), fmt(), chunk('fact', new Uint8Array(5)), data([0.5]))
    );

    expect(wav.samples).toEqual(floats(0.5));
  });

  it('reads the whole samples of a truncated data chunk', () => {
    const bytes = encode([0.5, -0.5, 0.25]).subarray(0, 10);

    const wav = parseWav(riff(fmt(), chunk('data', bytes, 4096)));

    expect(wav.samples).toEqual(floats(0.5, -0.5));
  });

  it('rejects a file that is not a WAV', () => {
    expect(() => parseWav(new ArrayBuffer(4))).toThrow('Not a WAV file');
    expect(() => parseWav(ascii('<Error>AccessDenied</Error>').buffer)).toThrow('Not a WAV file');
    const avi = new Uint8Array(riff(fmt(), data([0])));
    avi.set(ascii('AVI '), 8);
    expect(() => parseWav(avi.buffer)).toThrow('Not a WAV file');
  });

  it('rejects a WAV without fmt or data', () => {
    expect(() => parseWav(riff(data([0.5])))).toThrow('no fmt chunk');
    expect(() => parseWav(riff(fmt()))).toThrow('no data chunk');
    expect(() => parseWav(riff(chunk('fmt ', new Uint8Array(8)), data([0.5])))).toThrow('too short');
  });

  it('rejects formats it cannot read', () => {
    expect(() => parseWav(riff(fmt({ format: 2, bits: 4 }), chunk('data', new Uint8Array(4))))).toThrow(
      'Unsupported WAV format 2 with 4 bits'
    );
    expect(() => parseWav(riff(fmt({ format: PCM, bits: 12 }), chunk('data', new Uint8Array(4))))).toThrow(
      'Unsupported WAV format 1 with 12 bits'
    );
    expect(() => parseWav(riff(fmt({ channels: 0 }), data([0.5])))).toThrow('Invalid WAV block align 0');
  });
});
