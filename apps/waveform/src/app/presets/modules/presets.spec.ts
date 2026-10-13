import toast from 'react-hot-toast';
import { presetHash, Preset, PresetListItem } from '@waveform/preset-schema';
import { createAdsrEnvelope, initModel } from '../../../test-utils/models';
import { getSnapshot } from '../../app';
import { getPreset, getTopPresets, getUrlPresetId, setUrlPresetId } from '../services';
import { presets } from './presets';

jest.mock('../services', () => ({
  getPreset: jest.fn(),
  getTopPresets: jest.fn(),
  getUrlPresetId: jest.fn(() => null),
  setUrlPresetId: jest.fn(),
}));

const getPresetMock = getPreset as jest.MockedFunction<typeof getPreset>;
const getTopPresetsMock = getTopPresets as jest.MockedFunction<typeof getTopPresets>;
const getUrlPresetIdMock = getUrlPresetId as jest.MockedFunction<typeof getUrlPresetId>;

const preset = (id: string, attack: number): Preset =>
  ({ id, name: `Preset ${id}`, data: { adsr: { attack } } } as unknown as Preset);

const listItem = (id: string) => ({ id, name: id } as PresetListItem);

// resolves pending getPreset promises
const flush = () => new Promise((resolve) => jest.requireActual('timers').setImmediate(resolve));

const setup = () => {
  const adsr = createAdsrEnvelope();
  const model = initModel(presets(), 'presets', undefined);
  return { adsr, model };
};

beforeEach(() => {
  getUrlPresetIdMock.mockReturnValue(null);
  getTopPresetsMock.mockResolvedValue([]);
});
afterEach(() => jest.useRealTimers());

describe('presets model', () => {
  it('loads a preset: applies the snapshot and becomes clean', async () => {
    const {
      adsr: [{ $envelope }],
      model: [{ $current, $loadedHash, $dirty }, { loadById }],
    } = setup();
    getPresetMock.mockResolvedValue(preset('p1', 0.5));

    await loadById('p1');

    expect(getPresetMock).toHaveBeenCalledWith('p1');
    expect($envelope.value.attack).toBe(0.5);
    expect($current.value).toEqual({ id: 'p1', name: 'Preset p1' });
    expect($loadedHash.value).toBe(presetHash(getSnapshot()));
    expect($dirty.value).toBe(false);
    expect(setUrlPresetId).toHaveBeenCalledWith('p1');
  });

  it('applies only the last requested preset', async () => {
    const {
      adsr: [{ $envelope }],
      model: [{ $current }, { loadById }],
    } = setup();
    let resolveFirst: (value: Preset) => void = () => undefined;
    getPresetMock
      .mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce(preset('p2', 0.2));

    const first = loadById('p1');
    await loadById('p2');
    resolveFirst(preset('p1', 0.9));
    await first;

    expect($current.value?.id).toBe('p2');
    expect($envelope.value.attack).toBe(0.2);
  });

  it('shows an error when loading fails', async () => {
    const {
      model: [{ $current }, { loadById }],
    } = setup();
    getPresetMock.mockRejectedValue(new Error('Not found'));

    await loadById('p1');
    expect(toast.error).toHaveBeenCalledWith('Not found');

    await loadById('p1', 'Custom message');
    expect(toast.error).toHaveBeenLastCalledWith('Custom message');
    expect($current.value).toBeNull();
  });

  it('steps through the list with wrap-around', async () => {
    const {
      model: [{ $current }, { setList, next, prev }],
    } = setup();
    getPresetMock.mockImplementation((id) => Promise.resolve(preset(id, 0.1)));

    setList(['a', 'b', 'c'].map(listItem));
    next(); // no current preset → the first one
    await flush();
    expect($current.value?.id).toBe('a');

    prev();
    await flush();
    expect($current.value?.id).toBe('c');

    next();
    await flush();
    expect($current.value?.id).toBe('a');

    next();
    await flush();
    expect($current.value?.id).toBe('b');
  });

  it('loads the popular presets once on init', async () => {
    getTopPresetsMock.mockResolvedValue(['a', 'b'].map(listItem));
    const {
      model: [{ $top, $topLoading }],
    } = setup();
    expect($topLoading.value).toBe(true);
    await flush();

    expect(getTopPresetsMock).toHaveBeenCalledTimes(1);
    expect($top.value?.map(({ id }) => id)).toEqual(['a', 'b']);
    expect($topLoading.value).toBe(false);
  });

  it('a failed init load shows no error and leaves the list empty', async () => {
    getTopPresetsMock.mockRejectedValue(new Error('Server down'));
    const {
      model: [{ $top, $topLoading }],
    } = setup();
    await flush();

    expect(toast.error).not.toHaveBeenCalled();
    expect($top.value).toBeNull();
    expect($topLoading.value).toBe(false);
  });

  it('without a list walks the preloaded popular presets from the most popular', async () => {
    getTopPresetsMock.mockResolvedValue(['a', 'b', 'c'].map(listItem));
    const {
      model: [{ $current, $list }, { next }],
    } = setup();
    getPresetMock.mockImplementation((id) => Promise.resolve(preset(id, 0.1)));
    await flush();

    await next();
    expect($list.value.map(({ id }) => id)).toEqual(['a', 'b', 'c']);
    expect($current.value?.id).toBe('a');

    await next();
    expect($current.value?.id).toBe('b');
    expect(getTopPresetsMock).toHaveBeenCalledTimes(1); // only the init request
  });

  it('◀ without a current preset starts from the least popular', async () => {
    getTopPresetsMock.mockResolvedValue(['a', 'b', 'c'].map(listItem));
    const {
      model: [{ $current }, { prev }],
    } = setup();
    getPresetMock.mockImplementation((id) => Promise.resolve(preset(id, 0.1)));
    await flush();

    await prev();
    expect($current.value?.id).toBe('c');
  });

  it('drops ◀ ▶ clicks while the popular presets are loading', async () => {
    let resolveTop: (list: PresetListItem[]) => void = () => undefined;
    getTopPresetsMock.mockReturnValue(new Promise((resolve) => (resolveTop = resolve)));
    const {
      model: [{ $current }, { next }],
    } = setup();
    getPresetMock.mockImplementation((id) => Promise.resolve(preset(id, 0.1)));

    await next();
    resolveTop(['a', 'b'].map(listItem));
    await flush();

    expect(getTopPresetsMock).toHaveBeenCalledTimes(1);
    expect(getPresetMock).not.toHaveBeenCalled();
    expect($current.value).toBeNull();

    await next();
    expect($current.value?.id).toBe('a');
  });

  it('shares one request between parallel loadTop calls', async () => {
    getTopPresetsMock.mockResolvedValue(['a'].map(listItem));
    const {
      model: [, { loadTop }],
    } = setup();

    const [first, second] = await Promise.all([loadTop(), loadTop()]);
    expect(getTopPresetsMock).toHaveBeenCalledTimes(1); // the init one
    expect(first).toBe(second);
  });

  it('keeps the list chosen in the browser', async () => {
    getTopPresetsMock.mockResolvedValue(['a', 'b'].map(listItem));
    const {
      model: [{ $current }, { setList, next }],
    } = setup();
    getPresetMock.mockImplementation((id) => Promise.resolve(preset(id, 0.1)));
    await flush();
    setList(['x', 'y'].map(listItem));

    await next();
    expect($current.value?.id).toBe('x');
  });

  it('continues from the current preset when it is in the popular list', async () => {
    getTopPresetsMock.mockResolvedValue(['a', 'b', 'c'].map(listItem));
    const {
      model: [{ $current }, { setSaved, next }],
    } = setup();
    getPresetMock.mockImplementation((id) => Promise.resolve(preset(id, 0.1)));
    await flush();
    setSaved({ id: 'b', name: 'B' });

    await next();
    expect($current.value?.id).toBe('c');
  });

  it('◀ ▶ after a failed init retry the load and show an error if it fails again', async () => {
    getTopPresetsMock.mockRejectedValueOnce(new Error('Server down'));
    const {
      model: [{ $current, $list }, { next }],
    } = setup();
    getPresetMock.mockImplementation((id) => Promise.resolve(preset(id, 0.1)));
    await flush();

    getTopPresetsMock.mockRejectedValueOnce(new Error('Still down'));
    await next();
    expect(toast.error).toHaveBeenCalledWith('Still down');
    expect($current.value).toBeNull();

    getTopPresetsMock.mockResolvedValueOnce(['a'].map(listItem));
    await next();
    expect($current.value?.id).toBe('a');
    expect($list.value.map(({ id }) => id)).toEqual(['a']);
    expect(getTopPresetsMock).toHaveBeenCalledTimes(3);
  });

  it('an empty popular list is loaded: ◀ ▶ do nothing and do not request it again', async () => {
    const {
      model: [{ $top }, { next }],
    } = setup();
    await flush();
    expect($top.value).toEqual([]);

    await next();
    expect(getTopPresetsMock).toHaveBeenCalledTimes(1);
    expect(getPresetMock).not.toHaveBeenCalled();
  });

  it('marks the preset dirty when params change and clean when they return', () => {
    jest.useFakeTimers();
    const {
      adsr: [, { setEnvelopeValue }],
      model: [{ $dirty, $current }, { setSaved }],
    } = setup();

    // nothing is loaded: never dirty
    setEnvelopeValue('attack', 0.3);
    jest.advanceTimersByTime(200);
    expect($dirty.value).toBe(false);

    setSaved({ id: 's1', name: 'Saved' });
    expect($current.value).toEqual({ id: 's1', name: 'Saved' });
    expect(setUrlPresetId).toHaveBeenCalledWith('s1');

    setEnvelopeValue('attack', 0.4);
    jest.advanceTimersByTime(199);
    expect($dirty.value).toBe(false);
    jest.advanceTimersByTime(1);
    expect($dirty.value).toBe(true);

    setEnvelopeValue('attack', 0.3);
    jest.advanceTimersByTime(200);
    expect($dirty.value).toBe(false);
  });

  it('loads the preset from the url on init', async () => {
    getUrlPresetIdMock.mockReturnValue('from-url');
    getPresetMock.mockRejectedValue(new Error('404'));
    setup();
    await flush();
    expect(getPresetMock).toHaveBeenCalledWith('from-url');
    expect(toast.error).toHaveBeenCalledWith('Preset from the link was not found');
  });

  it('does not load anything without a preset in the url', () => {
    setup();
    expect(getPresetMock).not.toHaveBeenCalled();
  });
});
