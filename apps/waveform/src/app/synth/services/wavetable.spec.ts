import { ascii, wavetableFile } from '../../../test-utils/wav-file';
import { loadWavetable, wavetableId } from './wavetable';

const WAVE_SIZE = 2048;
const SIGNED_URL = 'https://bucket.s3/signed';

const response = (status: number, body: { text?: string; buffer?: ArrayBuffer } = {}) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body.text ?? ''),
    arrayBuffer: () => Promise.resolve(body.buffer ?? new ArrayBuffer(0)),
  } as Response);

// two full waves and an incomplete tail; values are exact in float32
const samples = Float32Array.from(
  { length: WAVE_SIZE * 2 + 100 },
  (_, i) => (i % WAVE_SIZE) / WAVE_SIZE - 0.5
);
const waves = [[...samples.slice(0, WAVE_SIZE)], [...samples.slice(WAVE_SIZE, WAVE_SIZE * 2)]];

const fetchMock = jest.fn();

// the link request and then the file itself
const respondOk = (buffer = wavetableFile(samples)) =>
  fetchMock
    .mockResolvedValueOnce(response(200, { text: SIGNED_URL }))
    .mockResolvedValueOnce(response(200, { buffer }));

beforeEach(() => {
  fetchMock.mockReset();
  Object.assign(globalThis, { fetch: fetchMock });
});

// the cache lives for the module, so every test loads its own ids
describe('loadWavetable', () => {
  it('fetches the signed link, then the file, and splits it into whole waves', async () => {
    respondOk();

    const wavetable = await loadWavetable('Basics/Saw & Square #1.wav');

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/.netlify/functions/get-wavetable?id=Basics%2FSaw%20%26%20Square%20%231.wav',
      SIGNED_URL,
    ]);
    // (its mark: a morph)
    expect(wavetable).toEqual({ frames: waves, morph: true });
  });

  // decodeAudioData resampled a 44.1 kHz file to a 48 kHz context: 1.09 cycles a wave, 9% more waves
  it('takes the waves as stored, whatever the sample rate of the file', async () => {
    respondOk(wavetableFile(samples, 44100));
    respondOk(wavetableFile(samples, 48000));

    expect((await loadWavetable('rate-44100.wav')).frames).toEqual(waves);
    expect((await loadWavetable('rate-48000.wav')).frames).toEqual(waves);
  });

  it('loads every wavetable once, also for parallel requests', async () => {
    respondOk();

    const [first, second] = await Promise.all([loadWavetable('cached.wav'), loadWavetable('cached.wav')]);
    const third = await loadWavetable('cached.wav');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('rejects when the link request fails and loads again next time', async () => {
    fetchMock.mockResolvedValueOnce(response(500));
    await expect(loadWavetable('link-fails.wav')).rejects.toThrow('500');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    respondOk();
    expect((await loadWavetable('link-fails.wav')).frames).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('rejects when the file request fails', async () => {
    fetchMock.mockResolvedValueOnce(response(200, { text: SIGNED_URL })).mockResolvedValueOnce(response(403));
    await expect(loadWavetable('file-fails.wav')).rejects.toThrow('403');
  });

  it('does not keep a network error, a file that is not a WAV or one without a whole wave', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(loadWavetable('broken.wav')).rejects.toThrow('Failed to fetch');

    respondOk(ascii('<Error>AccessDenied</Error>').buffer);
    await expect(loadWavetable('broken.wav')).rejects.toThrow('Not a WAV file');

    respondOk(wavetableFile(samples.slice(0, WAVE_SIZE - 1)));
    await expect(loadWavetable('broken.wav')).rejects.toThrow('broken.wav is shorter than one wave');

    respondOk();
    expect((await loadWavetable('broken.wav')).frames).toEqual(waves);
  });
});

describe('wavetableId', () => {
  it('is the last element of the path', () => {
    expect(wavetableId(['ESW', 'Basics', 'ESW/Basics/Saw.wav'])).toBe('ESW/Basics/Saw.wav');
    expect(wavetableId(['folder', 1])).toBe('1');
    expect(wavetableId([])).toBe('');
  });
});
