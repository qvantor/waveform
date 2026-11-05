import { jsonResponse as response } from '../../../test-utils/query-client';
import { fetchList, fetchOk } from './fetch';

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
