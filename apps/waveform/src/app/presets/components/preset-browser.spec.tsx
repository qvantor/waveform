import { act, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import toast from 'react-hot-toast';
import { PresetListItem } from '@waveform/preset-schema';
import { fakePreset } from '../../../test-utils/presets-fixtures';
import { renderWithPresets } from '../../../test-utils/presets-wrapper';
import { getPreset, getTopPresets, listPresets, reportPreset, sharePreset } from '../services';
import { PresetBrowser } from './preset-browser';

jest.mock('../services', () => ({
  ...jest.requireActual('../services'),
  getPreset: jest.fn(),
  getTopPresets: jest.fn(),
  listPresets: jest.fn(),
  reportPreset: jest.fn(),
  sharePreset: jest.fn(),
}));

const getPresetMock = jest.mocked(getPreset);
const getTopPresetsMock = jest.mocked(getTopPresets);
const listPresetsMock = jest.mocked(listPresets);

const item = (id: string, name: string, uniqueUsers = 0): PresetListItem => ({ id, name, uniqueUsers });
const top = [item('t1', 'Top one', 12), item('t2', 'Top two')];

// a row's icon buttons: share, report
const rowButtons = async (name: string) =>
  within((await screen.findByText(name)).parentElement as HTMLElement).getAllByRole('button');

const setup = () => {
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  const onClose = jest.fn();
  const result = renderWithPresets(<PresetBrowser open onClose={onClose} />);
  return { ...result, user, onClose };
};

// debounces run on fake timers, waitFor/findBy advance them
beforeEach(() => {
  jest.useFakeTimers();
  getTopPresetsMock.mockResolvedValue(top);
  listPresetsMock.mockResolvedValue({ items: [item('a1', 'All one')], nextCursor: null });
  getPresetMock.mockImplementation(fakePreset);
});
afterEach(() => jest.useRealTimers());

describe('PresetBrowser', () => {
  it('shows popular presets with their unique users', async () => {
    setup();
    expect(await screen.findByText('Top one')).toBeInTheDocument();
    expect(screen.getByText('Top two')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    // the full list is loaded only when its tab is opened
    expect(listPresetsMock).not.toHaveBeenCalled();
    // the popular list comes from the model's request on start
    expect(getTopPresetsMock).toHaveBeenCalledTimes(1);
  });

  it('retries the popular presets on open after a failed load on start', async () => {
    getTopPresetsMock.mockRejectedValueOnce(new Error('Server down'));
    const { rerender, presets } = renderWithPresets(<PresetBrowser open={false} onClose={jest.fn()} />);
    await waitFor(() => expect(presets[0].$topLoading.value).toBe(false));
    expect(presets[0].$top.value).toBeNull();

    rerender(<PresetBrowser open onClose={jest.fn()} />);
    expect(await screen.findByText('Top one')).toBeInTheDocument();
    expect(getTopPresetsMock).toHaveBeenCalledTimes(2);
  });

  it('shows an empty state', async () => {
    getTopPresetsMock.mockResolvedValue([]);
    setup();
    expect(await screen.findByText('No presets')).toBeInTheDocument();
  });

  it('loads the selected preset and uses the list for ◀ ▶', async () => {
    const { user, presets } = setup();
    await user.click(await screen.findByText('Top two'));

    await waitFor(() => expect(presets[0].$current.value).toEqual({ id: 't2', name: 'Preset t2' }));
    expect(getPresetMock).toHaveBeenCalledWith('t2');
    expect(presets[0].$list.value).toEqual(top);
  });

  it('lists all presets sorted by the chosen order', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('tab', { name: 'All' }));
    expect(await screen.findByText('All one')).toBeInTheDocument();
    expect(listPresetsMock).toHaveBeenLastCalledWith({ q: '', sort: 'new', cursor: undefined });

    await user.click(screen.getByText('A–Z'));
    await waitFor(() =>
      expect(listPresetsMock).toHaveBeenLastCalledWith({ q: '', sort: 'name', cursor: undefined })
    );
  });

  it('searches all presets after typing stops', async () => {
    listPresetsMock.mockImplementation(async ({ q }) => ({
      items: [item('s1', `Found ${q}`)],
      nextCursor: null,
    }));
    const { user } = setup();
    await user.type(screen.getByPlaceholderText('Search all presets'), '  bass ');

    expect(await screen.findByText('Found bass')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Search: bass' })).toHaveAttribute('aria-selected', 'true');
    expect(listPresetsMock).toHaveBeenCalledTimes(1);
  });

  it('loads the next page when the end of the list is visible', async () => {
    const observers: Array<(entries: Partial<IntersectionObserverEntry>[]) => void> = [];
    const original = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = jest.fn(
      (callback: (entries: Partial<IntersectionObserverEntry>[]) => void) => {
        observers.push(callback);
        return { observe: jest.fn(), disconnect: jest.fn() };
      }
    ) as unknown as typeof IntersectionObserver;
    listPresetsMock
      .mockResolvedValueOnce({ items: [item('a1', 'All one')], nextCursor: 'cursor-1' })
      .mockResolvedValueOnce({ items: [item('a2', 'All two')], nextCursor: null });

    try {
      const { user } = setup();
      await user.click(screen.getByRole('tab', { name: 'All' }));
      await screen.findByText('All one');
      await waitFor(() => expect(observers).not.toHaveLength(0));

      await act(async () => observers[observers.length - 1]([{ isIntersecting: true }]));
      expect(await screen.findByText('All two')).toBeInTheDocument();
      expect(screen.getByText('All one')).toBeInTheDocument();
      expect(listPresetsMock).toHaveBeenLastCalledWith({ q: '', sort: 'new', cursor: 'cursor-1' });
    } finally {
      globalThis.IntersectionObserver = original;
    }
  });

  it('copies a preset link without loading it', async () => {
    const { user } = setup();
    const [share] = await rowButtons('Top one');
    await user.click(share);

    expect(sharePreset).toHaveBeenCalledWith('t1');
    expect(getPresetMock).not.toHaveBeenCalled();
  });

  it('reports a preset after confirmation', async () => {
    jest.mocked(reportPreset).mockResolvedValue(undefined);
    const { user } = setup();
    const [, report] = await rowButtons('Top one');
    await user.click(report);
    await user.click(await screen.findByRole('button', { name: 'Report' }));

    expect(reportPreset).toHaveBeenCalledWith('t1');
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Thanks, the preset has been reported'));
    expect(getPresetMock).not.toHaveBeenCalled();
  });

  it('shows report errors', async () => {
    jest.mocked(reportPreset).mockRejectedValue(new Error('Already reported'));
    const { user } = setup();
    const [, report] = await rowButtons('Top one');
    await user.click(report);
    await user.click(await screen.findByRole('button', { name: 'Report' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Already reported'));
  });

  it('closes with Done', async () => {
    const { user, onClose } = setup();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });
});
