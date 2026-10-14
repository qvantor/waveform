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
const fileBuffer = new ArrayBuffer(8);

const fetchMock = jest.fn();
const decodeAudioData = jest.fn();
const audioCtx = { decodeAudioData } as unknown as BaseAudioContext;

// the link request and then the file itself
const respondOk = () =>
  fetchMock
    .mockResolvedValueOnce(response(200, { text: SIGNED_URL }))
    .mockResolvedValueOnce(response(200, { buffer: fileBuffer }));

beforeEach(() => {
  fetchMock.mockReset();
  decodeAudioData.mockReset();
  decodeAudioData.mockResolvedValue({ length: samples.length, getChannelData: () => samples });
  Object.assign(globalThis, { fetch: fetchMock });
});

// the cache lives for the module, so every test loads its own ids
describe('loadWavetable', () => {
  it('fetches the signed link, then the file, and splits it into whole waves', async () => {
    respondOk();

    const wavetable = await loadWavetable(audioCtx, 'Basics/Saw & Square #1.wav');

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/.netlify/functions/get-wavetable?id=Basics%2FSaw%20%26%20Square%20%231.wav',
      SIGNED_URL,
    ]);
    expect(decodeAudioData).toHaveBeenCalledWith(fileBuffer);
    expect(wavetable).toHaveLength(2);
    expect(wavetable[0]).toEqual([...samples.slice(0, WAVE_SIZE)]);
    expect(wavetable[1]).toEqual([...samples.slice(WAVE_SIZE, WAVE_SIZE * 2)]);
  });

  it('loads every wavetable once, also for parallel requests', async () => {
    respondOk();

    const [first, second] = await Promise.all([
      loadWavetable(audioCtx, 'cached.wav'),
      loadWavetable(audioCtx, 'cached.wav'),
    ]);
    const third = await loadWavetable(audioCtx, 'cached.wav');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('rejects when the link request fails and loads again next time', async () => {
    fetchMock.mockResolvedValueOnce(response(500));
    await expect(loadWavetable(audioCtx, 'link-fails.wav')).rejects.toThrow('500');
    expect(decodeAudioData).not.toHaveBeenCalled();

    respondOk();
    await expect(loadWavetable(audioCtx, 'link-fails.wav')).resolves.toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('rejects when the file request fails', async () => {
    fetchMock.mockResolvedValueOnce(response(200, { text: SIGNED_URL })).mockResolvedValueOnce(response(403));
    await expect(loadWavetable(audioCtx, 'file-fails.wav')).rejects.toThrow('403');
    expect(decodeAudioData).not.toHaveBeenCalled();
  });

  it('does not keep a network error or a file that cannot be decoded', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(loadWavetable(audioCtx, 'broken.wav')).rejects.toThrow('Failed to fetch');

    respondOk();
    decodeAudioData.mockRejectedValueOnce(new Error('Unable to decode audio data'));
    await expect(loadWavetable(audioCtx, 'broken.wav')).rejects.toThrow('Unable to decode');

    respondOk();
    await expect(loadWavetable(audioCtx, 'broken.wav')).resolves.toHaveLength(2);
  });
});

describe('wavetableId', () => {
  it('is the last element of the path', () => {
    expect(wavetableId(['ESW', 'Basics', 'ESW/Basics/Saw.wav'])).toBe('ESW/Basics/Saw.wav');
    expect(wavetableId(['folder', 1])).toBe('1');
    expect(wavetableId([])).toBe('');
  });
});
