import toast from 'react-hot-toast';
import { presetHash, Preset, PresetListItem } from '@waveform/preset-schema';
import { createAdsrEnvelope, initModel } from '../../../test-utils/models';
import { getSnapshot } from '../../app';
import { getPreset, getUrlPresetId, setUrlPresetId } from '../services';
import { presets } from './presets';

jest.mock('../services', () => ({
  getPreset: jest.fn(),
  getUrlPresetId: jest.fn(() => null),
  setUrlPresetId: jest.fn(),
}));

const getPresetMock = getPreset as jest.MockedFunction<typeof getPreset>;
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

    next();
    expect(getPresetMock).not.toHaveBeenCalled(); // empty list

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
