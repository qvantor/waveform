import { renderHook, waitFor } from '@testing-library/react';
import { jsonResponse, queryWrapper } from '../../../../test-utils/query-client';
import { samplesToOptions, useNoiseSamples } from './use-noise-samples';

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  Object.assign(globalThis, { fetch: fetchMock });
});

describe('samplesToOptions', () => {
  it('maps the folders to cascade options, a sample by its file name', () => {
    expect(
      samplesToOptions([
        { name: 'Analog', children: [{ Key: 'Analog/White.v2.wav', Size: 10 }] },
        { Key: 'Rain.wav', Size: 1 },
      ])
    ).toEqual([
      { value: 'Analog', label: 'Analog', children: [{ value: 'Analog/White.v2.wav', label: 'White.v2' }] },
      { value: 'Rain.wav', label: 'Rain' },
    ]);
  });
});

describe('useNoiseSamples', () => {
  it('gives the list of the function as options', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, [{ name: 'Analog', children: [{ Key: 'Analog/White.wav', Size: 1 }] }])
    );
    const { result } = renderHook(useNoiseSamples, queryWrapper());
    await waitFor(() =>
      expect(result.current).toEqual([
        { value: 'Analog', label: 'Analog', children: [{ value: 'Analog/White.wav', label: 'White' }] },
      ])
    );
    expect(fetchMock).toHaveBeenCalledWith('/.netlify/functions/get-noises-list');
  });

  it.each([
    ['a function that threw', 502, { errorType: 'Error', errorMessage: 'No bucket' }],
    ['an ok answer that is no list', 200, { error: 'Internal error' }],
  ])('has no options after %s, and renders', async (_, status, body) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(status, body));
    const { client, wrapper } = queryWrapper();
    const { result } = renderHook(useNoiseSamples, { wrapper });
    await waitFor(() => expect(client.getQueryState(['noises'])?.status).toBe('error'));
    expect(result.current).toEqual([]);
  });
});
