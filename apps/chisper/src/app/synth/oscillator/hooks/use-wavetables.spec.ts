import { renderHook, waitFor } from '@testing-library/react';
import { jsonResponse, queryWrapper } from '../../../../test-utils/query-client';
import { useWavetables, wavetablesToOptions } from './use-wavetables';

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  Object.assign(globalThis, { fetch: fetchMock });
});

describe('wavetablesToOptions', () => {
  it('maps the folder tree to cascade options with file names and sizes', () => {
    expect(
      wavetablesToOptions([
        {
          name: 'Basic',
          children: [
            { Key: 'Basic/Saw.wav', Size: 2048 },
            { name: 'Deep', children: [{ Key: 'Basic/Deep/Square.v2.wav', Size: 10 }] },
          ],
        },
        { Key: 'Sine.wav', Size: 1500000 },
      ])
    ).toEqual([
      {
        value: 'Basic',
        label: 'Basic',
        children: [
          { value: 'Basic/Saw.wav', label: 'Saw (2.05 kB)' },
          {
            value: 'Deep',
            label: 'Deep',
            children: [{ value: 'Basic/Deep/Square.v2.wav', label: 'Square (10 B)' }],
          },
        ],
      },
      { value: 'Sine.wav', label: 'Sine (1.5 MB)' },
    ]);
  });

  it('returns an empty list for no data', () => {
    expect(wavetablesToOptions([])).toEqual([]);
  });
});

describe('useWavetables', () => {
  it('gives the list of the function as options', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, [{ Key: 'Sine.wav', Size: 10 }]));
    const { result } = renderHook(useWavetables, queryWrapper());
    await waitFor(() => expect(result.current).toEqual([{ value: 'Sine.wav', label: 'Sine (10 B)' }]));
    expect(fetchMock).toHaveBeenCalledWith('/.netlify/functions/get-wavetables-list');
  });

  it.each([
    ['a function that threw', 502, { errorType: 'Error', errorMessage: 'No bucket' }],
    ['an ok answer that is no list', 200, { error: 'Internal error' }],
  ])('has no options after %s, and renders', async (_, status, body) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(status, body));
    const { client, wrapper } = queryWrapper();
    const { result } = renderHook(useWavetables, { wrapper });
    await waitFor(() => expect(client.getQueryState(['wavetables'])?.status).toBe('error'));
    expect(result.current).toEqual([]);
  });
});
