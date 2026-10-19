import toast from 'react-hot-toast';
import {
  DEFAULT_WAVETABLE_PATH,
  normalizePreset,
  presetHash,
  Preset,
  PresetListItem,
} from '@waveform/preset-schema';
import { createEnvelopes, createFx, createSynth, initModel } from '../../../test-utils/models';
import { getSnapshot } from '../../app';
import {
  clearUrlPresetId,
  getEditToken,
  getPreset,
  getTopPresets,
  getUrlPresetId,
  markPresetOpened,
  setUrlPresetId,
} from '../services';
import { presets } from './presets';

jest.mock('../services', () => ({
  clearUrlPresetId: jest.fn(),
  getEditToken: jest.fn(),
  getPreset: jest.fn(),
  getTopPresets: jest.fn(),
  getUrlPresetId: jest.fn(() => null),
  markPresetOpened: jest.fn(),
  setUrlPresetId: jest.fn(),
}));

const getEditTokenMock = jest.mocked(getEditToken);
const markPresetOpenedMock = jest.mocked(markPresetOpened);
const getPresetMock = getPreset as jest.MockedFunction<typeof getPreset>;
const getTopPresetsMock = getTopPresets as jest.MockedFunction<typeof getTopPresets>;
const getUrlPresetIdMock = getUrlPresetId as jest.MockedFunction<typeof getUrlPresetId>;

const preset = (id: string, attack: number): Preset =>
  ({ id, name: `Preset ${id}`, data: { env: { e1: { attack } } } } as unknown as Preset);

// resolved by the test, for requests that must still be pending
const deferred = <T>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

const listItem = (id: string) => ({ id, name: id } as PresetListItem);

// resolves pending getPreset promises
const flush = () => new Promise((resolve) => jest.requireActual('timers').setImmediate(resolve));

const setup = () => {
  const env = createEnvelopes();
  const model = initModel(presets(), 'presets', undefined);
  return { env, model };
};

// the popular list is still loading on start; resolveTop delivers ['a']
const setupPendingTop = () => {
  const top = deferred<PresetListItem[]>();
  getTopPresetsMock.mockReturnValue(top.promise);
  const resolveTop = () => {
    top.resolve(['a'].map(listItem));
    return flush();
  };
  return { ...setup(), resolveTop };
};

beforeEach(() => {
  getUrlPresetIdMock.mockReturnValue(null);
  getTopPresetsMock.mockResolvedValue([]);
  getEditTokenMock.mockReturnValue(undefined);
  markPresetOpenedMock.mockResolvedValue(undefined);
  // the preset opened on start is random, the first one unless a test picks another
  jest.spyOn(Math, 'random').mockReturnValue(0);
});
afterEach(() => jest.useRealTimers());

describe('presets model', () => {
  it('loads a preset: applies the snapshot and becomes clean', async () => {
    const {
      env: [{ $envelopes }],
      model: [{ $current, $loadedHash, $dirty }, { loadById }],
    } = setup();
    getPresetMock.mockResolvedValue(preset('p1', 0.5));

    await loadById('p1');

    expect(getPresetMock).toHaveBeenCalledWith('p1');
    expect($envelopes.value.env1.attack).toBe(0.5);
    expect($current.value).toEqual({ id: 'p1', name: 'Preset p1' });
    expect($loadedHash.value).toBe(presetHash(getSnapshot()));
    expect($dirty.value).toBe(false);
    expect(setUrlPresetId).toHaveBeenCalledWith('p1');
  });

  it('applies only the last requested preset', async () => {
    const {
      env: [{ $envelopes }],
      model: [{ $current }, { loadById }],
    } = setup();
    const p1 = deferred<Preset>();
    getPresetMock.mockReturnValueOnce(p1.promise).mockResolvedValueOnce(preset('p2', 0.2));

    const first = loadById('p1');
    await loadById('p2');
    p1.resolve(preset('p1', 0.9));
    await first;

    expect($current.value?.id).toBe('p2');
    expect($envelopes.value.env1.attack).toBe(0.2);
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
    expect(getPresetMock).not.toHaveBeenCalled(); // stays in Init
  });

  it('without a list walks the preloaded popular presets from the one opened on start', async () => {
    getTopPresetsMock.mockResolvedValue(['a', 'b', 'c'].map(listItem));
    const {
      model: [{ $current, $list }, { next }],
    } = setup();
    getPresetMock.mockImplementation((id) => Promise.resolve(preset(id, 0.1)));
    await flush();
    expect($current.value?.id).toBe('a');

    await next();
    expect($list.value.map(({ id }) => id)).toEqual(['a', 'b', 'c']);
    expect($current.value).toEqual({ id: 'b', name: 'Preset b' }); // chosen, not auto
    expect(setUrlPresetId).toHaveBeenCalledWith('b');
    expect(getTopPresetsMock).toHaveBeenCalledTimes(1); // only the init request
  });

  it('◀ ▶ from Init start from the least and the most popular', async () => {
    getTopPresetsMock.mockResolvedValue(['a', 'b', 'c'].map(listItem));
    const {
      model: [{ $current }, { prev, next, reset }],
    } = setup();
    getPresetMock.mockImplementation((id) => Promise.resolve(preset(id, 0.1)));
    await flush();

    reset();
    await prev();
    expect($current.value?.id).toBe('c');

    reset();
    await next();
    expect($current.value?.id).toBe('a');
  });

  it('drops ◀ ▶ clicks while the popular presets are loading', async () => {
    const top = deferred<PresetListItem[]>();
    getTopPresetsMock.mockReturnValue(top.promise);
    const {
      model: [{ $current }, { next }],
    } = setup();
    getPresetMock.mockImplementation((id) => Promise.resolve(preset(id, 0.1)));

    await next();
    expect(getPresetMock).not.toHaveBeenCalled();
    top.resolve(['a', 'b'].map(listItem));
    await flush();

    // only the one opened on start
    expect(getTopPresetsMock).toHaveBeenCalledTimes(1);
    expect(getPresetMock).toHaveBeenCalledTimes(1);
    expect($current.value?.id).toBe('a');

    await next();
    expect($current.value?.id).toBe('b');
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

  it('opens a popular preset on start without a link', async () => {
    getTopPresetsMock.mockResolvedValue(['a', 'b'].map(listItem));
    getPresetMock.mockImplementation((id) => Promise.resolve(preset(id, 0.5)));
    const {
      env: [{ $envelopes }],
      model: [{ $current, $dirty, $loadedHash }],
    } = setup();
    await flush();

    expect(getPresetMock).toHaveBeenCalledTimes(1);
    expect(getPresetMock).toHaveBeenCalledWith('a');
    expect($current.value).toEqual({ id: 'a', name: 'Preset a', auto: true });
    expect($envelopes.value.env1.attack).toBe(0.5);
    expect($loadedHash.value).toBe(presetHash(getSnapshot()));
    expect($dirty.value).toBe(false);
    // not in the url: a reload opens a random popular one again, not this one as chosen
    expect(setUrlPresetId).not.toHaveBeenCalled();
    expect(clearUrlPresetId).toHaveBeenCalledTimes(1);
  });

  it.each([
    [0.5, 'b'],
    [0.99, 'c'],
  ])('opens a random one of the popular presets on start (%s: %s)', async (random, id) => {
    getTopPresetsMock.mockResolvedValue(['a', 'b', 'c'].map(listItem));
    getPresetMock.mockImplementation((id) => Promise.resolve(preset(id, 0.5)));
    jest.mocked(Math.random).mockReturnValue(random);
    const {
      model: [{ $current }],
    } = setup();
    await flush();
    expect(getPresetMock).toHaveBeenCalledTimes(1);
    expect($current.value).toEqual({ id, name: `Preset ${id}`, auto: true });
  });

  it('▶ continues from the random preset opened on start', async () => {
    getTopPresetsMock.mockResolvedValue(['a', 'b', 'c'].map(listItem));
    getPresetMock.mockImplementation((id) => Promise.resolve(preset(id, 0.5)));
    jest.mocked(Math.random).mockReturnValue(0.99);
    const {
      model: [{ $current }, { next }],
    } = setup();
    await flush();
    expect($current.value?.id).toBe('c');

    await next();
    expect($current.value).toEqual({ id: 'a', name: 'Preset a' });
  });

  it('the preset opened on start becomes chosen and goes to the url when it is opened again', async () => {
    getTopPresetsMock.mockResolvedValue(['a', 'b'].map(listItem));
    getPresetMock.mockImplementation((id) => Promise.resolve(preset(id, 0.5)));
    const {
      model: [{ $current }, { loadById }],
    } = setup();
    await flush();
    expect($current.value?.auto).toBe(true);

    await loadById('a');
    expect($current.value).toEqual({ id: 'a', name: 'Preset a' });
    expect(setUrlPresetId).toHaveBeenCalledWith('a');
  });

  it('a failed load of the popular preset stays in Init without an error', async () => {
    getTopPresetsMock.mockResolvedValue(['a'].map(listItem));
    getPresetMock.mockRejectedValue(new Error('Not found'));
    const {
      model: [{ $current }],
    } = setup();
    await flush();

    expect(getPresetMock).toHaveBeenCalledWith('a');
    expect(toast.error).not.toHaveBeenCalled();
    expect($current.value).toBeNull();
  });

  it('with a link opens only the preset of the link, even when it is not found', async () => {
    getUrlPresetIdMock.mockReturnValue('from-url');
    getTopPresetsMock.mockResolvedValue(['a'].map(listItem));
    getPresetMock.mockRejectedValue(new Error('404'));
    const {
      model: [{ $current, $top }],
    } = setup();
    await flush();

    expect($top.value?.map(({ id }) => id)).toEqual(['a']);
    expect(getPresetMock).toHaveBeenCalledTimes(1);
    expect(getPresetMock).toHaveBeenCalledWith('from-url');
    expect($current.value).toBeNull();
  });

  it('does not open a popular preset when params were changed before the list arrived', async () => {
    getPresetMock.mockImplementation((id) => Promise.resolve(preset(id, 0.5)));
    const {
      env: [{ $envelopes }, { setEnvelopeValue }],
      model: [{ $current }],
      resolveTop,
    } = setupPendingTop();

    setEnvelopeValue('env1', 'attack', 0.3);
    await resolveTop();

    expect(getPresetMock).not.toHaveBeenCalled();
    expect($current.value).toBeNull();
    expect($envelopes.value.env1.attack).toBe(0.3);
  });

  it('does not apply the popular preset when params were changed while it loaded', async () => {
    getTopPresetsMock.mockResolvedValue(['a'].map(listItem));
    const loading = deferred<Preset>();
    getPresetMock.mockReturnValue(loading.promise);
    const {
      env: [{ $envelopes }, { setEnvelopeValue }],
      model: [{ $current }],
    } = setup();
    await flush();
    expect(getPresetMock).toHaveBeenCalledWith('a');

    setEnvelopeValue('env1', 'attack', 0.3);
    loading.resolve(preset('a', 0.5));
    await flush();

    expect($current.value).toBeNull();
    expect($envelopes.value.env1.attack).toBe(0.3);
    expect(setUrlPresetId).not.toHaveBeenCalled();
  });

  it('a preset chosen before the list arrived is kept', async () => {
    getPresetMock.mockImplementation((id) => Promise.resolve(preset(id, 0.5)));
    const {
      model: [{ $current }, { loadById }],
      resolveTop,
    } = setupPendingTop();

    await loadById('x');
    await resolveTop();

    expect(getPresetMock).toHaveBeenCalledTimes(1);
    expect($current.value).toEqual({ id: 'x', name: 'Preset x' });
  });

  it('a preset saved before the list arrived is kept', async () => {
    const {
      model: [{ $current }, { setSaved }],
      resolveTop,
    } = setupPendingTop();

    setSaved({ id: 's1', name: 'Saved' });
    await resolveTop();

    expect(getPresetMock).not.toHaveBeenCalled();
    expect($current.value).toEqual({ id: 's1', name: 'Saved' });
  });

  it('Init before the list arrived keeps Init', async () => {
    const {
      model: [{ $current }, { reset }],
      resolveTop,
    } = setupPendingTop();

    reset();
    await resolveTop();

    expect(getPresetMock).not.toHaveBeenCalled();
    expect($current.value).toBeNull();
  });

  it('Init resets the sound to the defaults and leaves the preset', async () => {
    jest.useFakeTimers();
    const {
      env: [{ $envelopes }, { setEnvelopeValue }],
      model: [{ $current, $loadedHash, $dirty }, { loadById, reset }],
    } = setup();
    // sustain 0 and decay 0 are falsy: the defaults come back, not the preset values
    getPresetMock.mockResolvedValue({
      id: 'p1',
      name: 'Pluck',
      data: { env: { e1: { attack: 0.5, hold: 0, decay: 0.3, sustain: 0, release: 0.2 } } },
    } as unknown as Preset);
    await loadById('p1');
    setEnvelopeValue('env1', 'decay', 0);
    jest.advanceTimersByTime(200);
    expect($dirty.value).toBe(true);

    reset();

    expect($envelopes.value.env1).toEqual({ attack: 0.005, hold: 0.1, decay: 0, sustain: 1, release: 0.005 });
    expect(presetHash(getSnapshot())).toBe(presetHash({}));
    expect($current.value).toBeNull();
    expect($loadedHash.value).toBeNull();
    expect($dirty.value).toBe(false);
    expect(clearUrlPresetId).toHaveBeenCalledTimes(1);

    // changes on Init never make it dirty
    jest.advanceTimersByTime(200);
    setEnvelopeValue('env1', 'attack', 0.3);
    jest.advanceTimersByTime(200);
    expect($dirty.value).toBe(false);
  });

  it('a preset still loading is not applied over Init', async () => {
    const {
      env: [{ $envelopes }],
      model: [{ $current }, { loadById, reset }],
    } = setup();
    const loading = deferred<Preset>();
    getPresetMock.mockReturnValue(loading.promise);

    const load = loadById('p1');
    reset();
    loading.resolve(preset('p1', 0.5));
    await load;

    expect($current.value).toBeNull();
    expect($envelopes.value.env1.attack).toBe(0.005);
  });

  it('the start state of the synth is Init', () => {
    const { synthCore, modulation } = createSynth(DEFAULT_WAVETABLE_PATH);
    createFx(synthCore, modulation);

    // every snapshot model is registered: nothing is filled in by the schema
    expect(getSnapshot()).toEqual(normalizePreset({}));
  });

  it('marks the preset dirty when params change and clean when they return', () => {
    jest.useFakeTimers();
    const {
      env: [, { setEnvelopeValue }],
      model: [{ $dirty, $current }, { setSaved }],
    } = setup();

    // nothing is loaded: never dirty
    setEnvelopeValue('env1', 'attack', 0.3);
    jest.advanceTimersByTime(200);
    expect($dirty.value).toBe(false);

    setSaved({ id: 's1', name: 'Saved' });
    expect($current.value).toEqual({ id: 's1', name: 'Saved' });
    expect(setUrlPresetId).toHaveBeenCalledWith('s1');

    setEnvelopeValue('env1', 'attack', 0.4);
    jest.advanceTimersByTime(199);
    expect($dirty.value).toBe(false);
    jest.advanceTimersByTime(1);
    expect($dirty.value).toBe(true);

    setEnvelopeValue('env1', 'attack', 0.3);
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

  describe('own presets', () => {
    // presets saved from this browser have edit tokens
    const ownPresets = (...ids: string[]) =>
      getEditTokenMock.mockImplementation((id) => (ids.includes(id) ? `token-${id}` : undefined));

    beforeEach(() => {
      getPresetMock.mockImplementation((id) => Promise.resolve(preset(id, 0.5)));
    });

    it('opening an own preset keeps it from the cleanup, once a session', async () => {
      ownPresets('own');
      const {
        model: [, { loadById }],
      } = setup();

      await loadById('own');
      await loadById('other');
      await loadById('own');

      expect(markPresetOpenedMock).toHaveBeenCalledTimes(1);
      expect(markPresetOpenedMock).toHaveBeenCalledWith('own', { editToken: 'token-own' });
    });

    it('an own preset from the link and the one opened on start are kept too', async () => {
      ownPresets('from-url', 'a');
      getUrlPresetIdMock.mockReturnValue('from-url');
      setup();
      await flush();
      expect(markPresetOpenedMock).toHaveBeenCalledWith('from-url', { editToken: 'token-from-url' });

      getUrlPresetIdMock.mockReturnValue(null);
      getTopPresetsMock.mockResolvedValue(['a'].map(listItem));
      const {
        model: [{ $current }],
      } = setup();
      await flush();
      expect($current.value?.auto).toBe(true);
      expect(markPresetOpenedMock).toHaveBeenLastCalledWith('a', { editToken: 'token-a' });
    });

    it('a failed request is sent again on the next opening, without an error', async () => {
      ownPresets('own');
      markPresetOpenedMock.mockRejectedValueOnce(new Error('offline'));
      const {
        model: [{ $current }, { loadById }],
      } = setup();

      await loadById('own');
      await flush();
      expect($current.value?.id).toBe('own');
      expect(toast.error).not.toHaveBeenCalled();

      await loadById('own');
      await loadById('own');
      expect(markPresetOpenedMock).toHaveBeenCalledTimes(2);
    });

    it('saving does not send it: a saved or updated preset is kept by its own dates', () => {
      ownPresets('s1');
      const {
        model: [, { setSaved }],
      } = setup();
      setSaved({ id: 's1', name: 'Saved' });
      expect(markPresetOpenedMock).not.toHaveBeenCalled();
    });
  });
});
