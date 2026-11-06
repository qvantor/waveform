import { ascii, data, fmt, riff } from '../../../test-utils/wav-file';
import { loadNoiseSample } from './noise';

const response = (status: number, buffer = new ArrayBuffer(0)) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: () => Promise.resolve(buffer),
  }) as Response;

const floats = (...values: number[]) => Float32Array.from(values);

// interleaved frames of `channels` channels
const sampleFile = (channels: number, values: number[], sampleRate = 48000) =>
  riff(fmt({ channels, sampleRate }), data(values));

const fetchMock = jest.fn();

const respondOk = (buffer = sampleFile(2, [0.5, -0.5, 0.25, -0.25])) =>
  fetchMock.mockResolvedValueOnce(response(200, buffer));

const urls = () => fetchMock.mock.calls.map(([url]) => url);

let warn: jest.SpyInstance;
beforeEach(() => {
  fetchMock.mockReset();
  Object.assign(globalThis, { fetch: fetchMock });
  // a file the domain doesn't give is tried through the site
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => warn.mockRestore());

// the cache lives for the module, so every test loads its own ids
describe('loadNoiseSample', () => {
  it('fetches the file from the domain of the bucket by its key, its channels at its own rate', async () => {
    respondOk();

    const sample = await loadNoiseSample('Analog/White & Pink #2.wav');

    expect(urls()).toEqual(['https://noises.chisper.qvantor.org/Analog/White%20%26%20Pink%20%232.wav']);
    expect(sample).toEqual({ channels: [floats(0.5, 0.25), floats(-0.5, -0.25)], sampleRate: 48000 });
  });

  it('keeps two channels at most', async () => {
    respondOk(sampleFile(3, [0.5, -0.5, 1, 0.25, -0.25, 1], 44100));

    expect(await loadNoiseSample('three.wav')).toEqual({
      channels: [floats(0.5, 0.25), floats(-0.5, -0.25)],
      sampleRate: 44100,
    });
  });

  it('loads every sample once, also for parallel requests', async () => {
    respondOk();

    const [first, second] = await Promise.all([loadNoiseSample('cached.wav'), loadNoiseSample('cached.wav')]);
    const third = await loadNoiseSample('cached.wav');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  // a domain throttled or blocked on the way: the site proxies the bucket (netlify.toml)
  it('loads the file through the site where the domain of the bucket fails', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    respondOk();
    expect((await loadNoiseSample('Analog/White & Pink.wav')).sampleRate).toBe(48000);

    // through the site first from then on, from the domain again where only it gives a file
    fetchMock.mockResolvedValueOnce(response(502));
    respondOk();
    await loadNoiseSample('Analog/Brown.wav');
    expect(urls()).toEqual([
      'https://noises.chisper.qvantor.org/Analog/White%20%26%20Pink.wav',
      '/files/noises/Analog/White%20%26%20Pink.wav',
      '/files/noises/Analog/Brown.wav',
      'https://noises.chisper.qvantor.org/Analog/Brown.wav',
    ]);
  });

  it('does not keep a failed request, a file that is not a WAV or one without samples', async () => {
    fetchMock.mockResolvedValueOnce(response(404)).mockResolvedValueOnce(response(404));
    await expect(loadNoiseSample('broken.wav')).rejects.toThrow('/files/noises/broken.wav responded 404');

    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(loadNoiseSample('broken.wav')).rejects.toThrow('Failed to fetch');

    respondOk(ascii('<Error>AccessDenied</Error>').buffer);
    respondOk(ascii('<Error>AccessDenied</Error>').buffer);
    await expect(loadNoiseSample('broken.wav')).rejects.toThrow('Not a WAV file');

    respondOk(sampleFile(1, []));
    respondOk(sampleFile(1, []));
    await expect(loadNoiseSample('broken.wav')).rejects.toThrow('broken.wav has no samples');

    respondOk();
    expect((await loadNoiseSample('broken.wav')).channels).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(9);
  });
});
