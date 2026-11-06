import { jsonResponse as response } from '../../../test-utils/query-client';
import { bucketLoader, fetchList, fetchOk, FIRST_LIMITS, RATE_WINDOW_MS, SECOND_LIMITS } from './fetch';

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  Object.assign(globalThis, { fetch: fetchMock });
});

describe('fetchOk', () => {
  it('gives an ok response, fails on another status with the url', async () => {
    const ok = response(200, null);
    fetchMock.mockResolvedValueOnce(ok);
    await expect(fetchOk('/file')).resolves.toBe(ok);
    fetchMock.mockResolvedValueOnce(response(404, null));
    await expect(fetchOk('/file')).rejects.toThrow('/file responded 404');
  });
});

describe('fetchList', () => {
  it('gives the list a function answers', async () => {
    fetchMock.mockResolvedValueOnce(response(200, [{ Key: 'A/one.wav', Size: 1 }]));
    await expect(fetchList('/list')).resolves.toEqual([{ Key: 'A/one.wav', Size: 1 }]);
    expect(fetchMock).toHaveBeenCalledWith('/list');
  });

  it('fails on a function that threw (Netlify answers its error as JSON)', async () => {
    fetchMock.mockResolvedValueOnce(response(502, { errorType: 'Error', errorMessage: 'No bucket' }));
    await expect(fetchList('/list')).rejects.toThrow('/list responded 502');
  });

  it.each([
    ['an object', { error: 'Internal error' }],
    ['null', null],
    ['a string', 'list'],
  ])('fails on an ok answer that is no list: %s', async (_, body) => {
    fetchMock.mockResolvedValueOnce(response(200, body));
    await expect(fetchList('/list')).rejects.toThrow('/list answered no list');
  });
});

describe('bucketLoader', () => {
  const ORIGIN = 'https://bucket.test';
  const PROXY = '/files/bucket';
  const domain = (key: string) => `${ORIGIN}/${encodeURIComponent(key)}`;
  const site = (key: string) => `${PROXY}/${encodeURIComponent(key)}`;

  // (jsdom has no TextEncoder)
  const bytes = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));
  const file = (status: number, text = 'file') =>
    ({
      ok: status >= 200 && status < 300,
      status,
      arrayBuffer: () => Promise.resolve(bytes(text).buffer),
    }) as Response;
  // an answer whose body comes in these chunks, each when its promise resolves
  const streamed = (...chunks: Promise<string>[]) => {
    const read = jest.fn(async () => {
      const chunk = chunks.shift();
      return chunk ? { done: false, value: bytes(await chunk) } : { done: true, value: undefined };
    });
    return { ok: true, status: 200, body: { getReader: () => ({ read }) } } as unknown as Response;
  };
  const never = () => new Promise<never>(() => undefined);
  const after = (ms: number, text: string) =>
    new Promise<string>((resolve) => setTimeout(() => resolve(text), ms));
  // a byte every `every` ms, never the whole file: throttled to a trickle
  const trickle = (every: number, count: number) =>
    streamed(...Array.from({ length: count }, (_, i) => after((i + 1) * every, 'x')), never());
  // the whole file in `seconds` chunks of `rate` bytes, one a second: a slow line
  const steady = (rate: number, seconds: number) =>
    streamed(...Array.from({ length: seconds }, (_, i) => after((i + 1) * 1000, 'x'.repeat(rate))));
  // the first chunk of a trickle past the rate window: where it is caught
  const caughtAt = (every: number) => Math.ceil(RATE_WINDOW_MS / every) * every;

  // the file is the text "file"; a page of a filter answered 200 is no file
  const parse = (buffer: ArrayBuffer) => {
    const text = String.fromCharCode(...new Uint8Array(buffer));
    if (text !== 'file') throw new Error(`Not the file: ${text}`);
    return text;
  };
  const urls = () => fetchMock.mock.calls.map(([url]) => url);
  const signal = (call: number): AbortSignal => fetchMock.mock.calls[call][1].signal;

  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    warn.mockRestore();
    jest.useRealTimers();
  });

  it('loads a file from the domain of its bucket, the request aborted if it stalls', async () => {
    const load = bucketLoader(ORIGIN, PROXY);
    fetchMock.mockResolvedValueOnce(file(200));

    await expect(load('A/one two.wav', parse)).resolves.toBe('file');
    expect(urls()).toEqual(['https://bucket.test/A/one%20two.wav']);
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['a network error', () => fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))],
    ['a status that is not ok', () => fetchMock.mockResolvedValueOnce(file(403))],
    ['a page that is not the file', () => fetchMock.mockResolvedValueOnce(file(200, '<html>Blocked'))],
  ])('loads through the site where the domain gives %s, then through the site first', async (_, fail) => {
    const load = bucketLoader(ORIGIN, PROXY);
    fail();
    fetchMock.mockResolvedValueOnce(file(200));

    await expect(load('one.wav', parse)).resolves.toBe('file');
    expect(urls()).toEqual([domain('one.wav'), site('one.wav')]);
    // the site within its limits too
    expect(signal(1)).toBeInstanceOf(AbortSignal);
    expect(warn).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(file(200));
    await expect(load('two.wav', parse)).resolves.toBe('file');
    expect(urls().slice(2)).toEqual([site('two.wav')]);
  });

  it('fails with the error of the site where both fail, and tries the domain first again', async () => {
    const load = bucketLoader(ORIGIN, PROXY);
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fetchMock.mockResolvedValueOnce(file(404));

    await expect(load('one.wav', parse)).rejects.toThrow(`${site('one.wav')} responded 404`);

    fetchMock.mockResolvedValueOnce(file(200));
    await expect(load('one.wav', parse)).resolves.toBe('file');
    expect(urls()).toEqual([domain('one.wav'), site('one.wav'), domain('one.wav')]);
  });

  it('goes back to the domain where the site fails later and the domain loads', async () => {
    const load = bucketLoader(ORIGIN, PROXY);
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fetchMock.mockResolvedValueOnce(file(200));
    await load('one.wav', parse);

    fetchMock.mockResolvedValueOnce(file(502));
    fetchMock.mockResolvedValueOnce(file(200));
    await expect(load('two.wav', parse)).resolves.toBe('file');
    // the first route has the stall limit, whichever it is
    expect(signal(2)).toBeInstanceOf(AbortSignal);

    fetchMock.mockResolvedValueOnce(file(200));
    await load('three.wav', parse);
    expect(urls().slice(2)).toEqual([site('two.wav'), domain('two.wav'), domain('three.wav')]);
  });

  // a connection to Cloudflare throttled on the way gives its first kilobytes, then nothing
  it('aborts a download that gives nothing for its stall limit and loads it through the site', async () => {
    jest.useFakeTimers();
    const load = bucketLoader(ORIGIN, PROXY);
    fetchMock.mockResolvedValueOnce(streamed(Promise.resolve('fi'), never()));
    fetchMock.mockResolvedValueOnce(file(200));

    const loaded = load('one.wav', parse);
    await jest.advanceTimersByTimeAsync(FIRST_LIMITS.stallMs - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1);
    await expect(loaded).resolves.toBe('file');
    expect(signal(0).aborted).toBe(true);
    expect(urls()).toEqual([domain('one.wav'), site('one.wav')]);
    expect(String(warn.mock.calls[0][1])).toContain(`gave nothing for ${FIRST_LIMITS.stallMs} ms`);
  });

  it('aborts a request that never answers after its stall limit', async () => {
    jest.useFakeTimers();
    const load = bucketLoader(ORIGIN, PROXY);
    fetchMock.mockReturnValueOnce(never());
    fetchMock.mockResolvedValueOnce(file(200));

    const loaded = load('one.wav', parse);
    await jest.advanceTimersByTimeAsync(FIRST_LIMITS.stallMs);
    await expect(loaded).resolves.toBe('file');
    expect(urls()).toEqual([domain('one.wav'), site('one.wav')]);
  });

  it('lets a slow download go on while its chunks keep coming', async () => {
    jest.useFakeTimers();
    const load = bucketLoader(ORIGIN, PROXY);
    const every = FIRST_LIMITS.stallMs - 1;
    // (within the rate window: its rate isn't measured yet)
    fetchMock.mockResolvedValueOnce(streamed(after(every, 'fi'), after(2 * every, 'le')));

    const loaded = load('one.wav', parse);
    await jest.advanceTimersByTimeAsync(2 * every);
    await expect(loaded).resolves.toBe('file');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // a slow line shared by the loads of a start gives each little: through the site it would start again from its
  // first byte on the same line
  it('lets a download go on for minutes while it gives its rate', async () => {
    jest.useFakeTimers();
    const load = bucketLoader(ORIGIN, PROXY);
    const rate = Math.ceil(FIRST_LIMITS.minRate * 1.25);
    fetchMock.mockResolvedValueOnce(steady(rate, 120));

    const loaded = load('one.wav', (buffer) => buffer.byteLength);
    await jest.advanceTimersByTimeAsync(120_000);
    await expect(loaded).resolves.toBe(120 * rate);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  // a connection throttled to a trickle never stalls
  it('aborts a download that gives under its rate over a window and loads it through the site', async () => {
    jest.useFakeTimers();
    const load = bucketLoader(ORIGIN, PROXY);
    const every = FIRST_LIMITS.stallMs - 1;
    const caught = caughtAt(every);
    fetchMock.mockResolvedValueOnce(trickle(every, caught / every));
    fetchMock.mockResolvedValueOnce(file(200));

    const loaded = load('one.wav', parse);
    await jest.advanceTimersByTimeAsync(caught - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1);
    await expect(loaded).resolves.toBe('file');
    expect(signal(0).aborted).toBe(true);
    expect(urls()).toEqual([domain('one.wav'), site('one.wav')]);
    expect(String(warn.mock.calls[0][1])).toContain(`gave under ${FIRST_LIMITS.minRate} B/s`);
  });

  it('measures every window apart: a fast start buys no trickle after it', async () => {
    jest.useFakeTimers();
    const load = bucketLoader(ORIGIN, PROXY);
    const every = FIRST_LIMITS.stallMs - 1;
    const window = caughtAt(every) / every;
    // ten windows of its rate at once, then a byte at a time
    const burst = Promise.resolve('x'.repeat((FIRST_LIMITS.minRate * 10 * RATE_WINDOW_MS) / 1000));
    const bytes = Array.from({ length: 2 * window }, (_, i) => after((i + 1) * every, 'x'));
    fetchMock.mockResolvedValueOnce(streamed(burst, ...bytes, never()));
    fetchMock.mockResolvedValueOnce(file(200));

    const loaded = load('one.wav', parse);
    // the first window has the burst, the second only the trickle
    await jest.advanceTimersByTimeAsync(2 * caughtAt(every) - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1);
    await expect(loaded).resolves.toBe('file');
    expect(urls()).toEqual([domain('one.wav'), site('one.wav')]);
  });

  it('waits for the site longer than for the domain', async () => {
    jest.useFakeTimers();
    const load = bucketLoader(ORIGIN, PROXY);
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => setTimeout(() => resolve(file(200)), SECOND_LIMITS.stallMs - 1))
    );

    const loaded = load('one.wav', parse);
    await jest.advanceTimersByTimeAsync(SECOND_LIMITS.stallMs - 1);
    await expect(loaded).resolves.toBe('file');
  });

  it('lets the site give less than the domain has to', async () => {
    jest.useFakeTimers();
    const load = bucketLoader(ORIGIN, PROXY);
    const rate = FIRST_LIMITS.minRate / 2;
    expect(rate).toBeGreaterThan(SECOND_LIMITS.minRate);
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fetchMock.mockResolvedValueOnce(steady(rate, 30));

    const loaded = load('one.wav', (buffer) => buffer.byteLength);
    await jest.advanceTimersByTimeAsync(30_000);
    await expect(loaded).resolves.toBe(30 * rate);
  });

  // blocked on the way: the site goes first, a failure of it tries the domain, which stalls
  it('fails a load whose second route stalls, the site first still', async () => {
    jest.useFakeTimers();
    const load = bucketLoader(ORIGIN, PROXY);
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fetchMock.mockResolvedValueOnce(file(200));
    await load('one.wav', parse);

    fetchMock.mockResolvedValueOnce(file(502));
    fetchMock.mockResolvedValueOnce(streamed(Promise.resolve('fi'), never()));
    const loaded = load('two.wav', parse);
    loaded.catch(() => undefined);
    await jest.advanceTimersByTimeAsync(SECOND_LIMITS.stallMs - 1);
    expect(urls().slice(2)).toEqual([site('two.wav'), domain('two.wav')]);
    expect(signal(3).aborted).toBe(false);

    await jest.advanceTimersByTimeAsync(1);
    await expect(loaded).rejects.toThrow(`${domain('two.wav')} gave nothing for ${SECOND_LIMITS.stallMs} ms`);
    expect(signal(3).aborted).toBe(true);

    fetchMock.mockResolvedValueOnce(file(200));
    await expect(load('two.wav', parse)).resolves.toBe('file');
    expect(urls().slice(4)).toEqual([site('two.wav')]);
  });

  it('fails a load whose second route gives under its rate', async () => {
    jest.useFakeTimers();
    const load = bucketLoader(ORIGIN, PROXY);
    const every = SECOND_LIMITS.stallMs - 1;
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fetchMock.mockResolvedValueOnce(trickle(every, caughtAt(every) / every));

    const loaded = load('one.wav', parse);
    loaded.catch(() => undefined);
    await jest.advanceTimersByTimeAsync(caughtAt(every));
    await expect(loaded).rejects.toThrow(`${site('one.wav')} gave under ${SECOND_LIMITS.minRate} B/s`);
    expect(signal(1).aborted).toBe(true);
  });

  it('aborts a response it does not read and leaves no timer', async () => {
    jest.useFakeTimers();
    const load = bucketLoader(ORIGIN, PROXY);
    fetchMock.mockResolvedValueOnce(file(403));
    fetchMock.mockResolvedValueOnce(streamed(Promise.resolve('fi'), Promise.resolve('le')));

    await expect(load('one.wav', parse)).resolves.toBe('file');
    // the response of the status not read: let go
    expect(signal(0).aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });
});
