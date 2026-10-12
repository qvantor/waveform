import {
  ApiRequestError,
  getPreset,
  getTopPresets,
  isNameAvailable,
  listPresets,
  reportPreset,
  savePreset,
  sendUsage,
  updatePreset,
} from './api';

const response = (status: number, body?: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: body === undefined ? () => Promise.reject(new Error('no body')) : () => Promise.resolve(body),
  } as Response);

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  Object.assign(globalThis, { fetch: fetchMock });
});

describe('api', () => {
  it('GETs without a JSON header and returns the body', async () => {
    fetchMock.mockResolvedValue(response(200, { id: 'a b' }));
    await expect(getPreset('a b')).resolves.toEqual({ id: 'a b' });
    expect(fetchMock).toHaveBeenCalledWith('/api/presets/a%20b', { headers: undefined });
  });

  it('sends JSON with a Content-Type header', async () => {
    fetchMock.mockResolvedValue(response(201, { id: '1', editToken: 't' }));
    const body = { name: 'Bass', data: {}, turnstileToken: 'x' } as never;
    await savePreset(body);
    expect(fetchMock).toHaveBeenCalledWith('/api/presets', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
  });

  it('PUTs updates to the preset url', async () => {
    fetchMock.mockResolvedValue(response(200, { id: '1' }));
    await updatePreset('1', { editToken: 't' } as never);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/presets/1',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ editToken: 't' }) })
    );
  });

  it('returns undefined on 204', async () => {
    fetchMock.mockResolvedValue(response(204));
    await expect(reportPreset('1')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('/api/presets/1/report', { method: 'POST', headers: undefined });
  });

  it('throws ApiRequestError with the server message', async () => {
    fetchMock.mockResolvedValue(response(429, { error: 'Too many requests' }));
    const error = await getTopPresets().catch((e) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 429, message: 'Too many requests' });
  });

  it('throws a fallback message when the error body is not JSON', async () => {
    fetchMock.mockResolvedValue(response(500));
    await expect(getTopPresets()).rejects.toMatchObject({
      status: 500,
      message: 'Something went wrong, try again',
    });
  });

  it('builds query params for name availability', async () => {
    fetchMock.mockResolvedValue(response(200, { available: true }));
    await isNameAvailable('My bass & lead');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/presets/name-available?name=My+bass+%26+lead');
  });

  it('adds q and cursor to the list query only when set', async () => {
    fetchMock.mockResolvedValue(response(200, { items: [], nextCursor: null }));
    await listPresets({ sort: 'popular' });
    await listPresets({ sort: 'new', q: 'pad', cursor: 'c1' });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/presets?sort=popular');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/presets?sort=new&q=pad&cursor=c1');
  });

  describe('sendUsage', () => {
    const body = { clientId: 'c', items: [{ presetId: 'p', seconds: 3 }] };

    afterEach(() => {
      Object.assign(navigator, { sendBeacon: undefined });
    });

    it('uses fetch with keepalive by default', async () => {
      fetchMock.mockResolvedValue(response(204));
      const sendBeacon = jest.fn(() => true);
      Object.assign(navigator, { sendBeacon });
      await sendUsage(body);
      expect(sendBeacon).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledWith('/api/usage', {
        method: 'POST',
        body: JSON.stringify(body),
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    it('uses a beacon with a JSON blob', async () => {
      const sendBeacon = jest.fn((_: string, __: Blob) => true);
      Object.assign(navigator, { sendBeacon });
      await sendUsage(body, true);
      expect(fetchMock).not.toHaveBeenCalled();
      const [url, blob] = sendBeacon.mock.calls[0];
      expect(url).toBe('/api/usage');
      expect(blob.type).toBe('application/json');
      expect(blob.size).toBe(JSON.stringify(body).length);
    });

    it('falls back to fetch when the beacon is rejected or missing', async () => {
      fetchMock.mockResolvedValue(response(204));
      Object.assign(navigator, { sendBeacon: jest.fn(() => false) });
      await sendUsage(body, true);
      Object.assign(navigator, { sendBeacon: undefined });
      await sendUsage(body, true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
