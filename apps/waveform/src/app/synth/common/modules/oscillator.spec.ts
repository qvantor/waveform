import { wave } from '@waveform/math';
import { applySnapshot, getSnapshot } from '../../../app';
import { createOscillator, createSynthCore, stopModels } from '../../../../test-utils/models';

type WaveMock = PeriodicWave & { real: number[]; imag: number[] };
const periodic = (value: PeriodicWave) => [(value as WaveMock).real, (value as WaveMock).imag];
// the periodic wave is the spectrum of the current wave, the math is tested in libs/math
const spectrum = (samples: number[]) => wave.realWithImag(samples);

const saw = [-1, -0.5, 0, 0.5];
const square = [1, 1, -1, -1];
// one sine cycle, played until a table loads
const placeholder = [0, 1, 0, -1];

const flush = () => new Promise((resolve) => setTimeout(resolve));

// an oscillator whose wavetable loads stay pending until the test settles them, the latest one per id
const createLoading = (initialWavePath = ['folder', 'a.wav']) => {
  const loads = new Map<string, { resolve: (table: number[][]) => void; reject: (error: Error) => void }>();
  const load = jest.fn(
    (_audioCtx: unknown, id: string) =>
      new Promise<number[][]>((resolve, reject) => loads.set(id, { resolve, reject }))
  );
  const synthCore = createSynthCore();
  const [model, actions] = createOscillator(synthCore, 'osc1', { active: true, initialWavePath }, load);
  const resolve = async (id: string, table: number[][]) => {
    loads.get(id)?.resolve(table);
    await flush();
  };
  const reject = async (id: string) => {
    loads.get(id)?.reject(new Error('404'));
    await flush();
  };
  // the first attempt and both retries fail
  const fail = async (id: string) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await reject(id);
      jest.advanceTimersByTime(1000);
    }
  };
  const table = () => model.$waveTable.value.map(({ value }) => value);
  return { model, actions, load, resolve, reject, fail, table, audioCtx: synthCore[0].audioCtx };
};

describe('oscillator', () => {
  it('starts with the initial state', () => {
    const [model] = createOscillator(undefined, 'osc1', {
      active: false,
      initialWavePath: ['folder', 'file.wav'],
    });
    expect(model.$active.value).toBe(false);
    expect(model.$waveTablePath.value).toEqual(['folder', 'file.wav']);
    expect(model.$osc.value).toEqual({ unison: 2, detune: 5, randPhase: 0, octave: 0 });
    expect(model.$waveTable.value.map(({ value }) => value)).toEqual([placeholder]);
    expect(periodic(model.$periodicWave.value)).toEqual(spectrum(placeholder));
  });

  it('plays a sine until a table loads', () => {
    const [model] = createOscillator();
    const [real, imag] = periodic(model.$periodicWave.value);
    real.forEach((value) => expect(value).toBeCloseTo(0));
    expect(imag[0]).toBeCloseTo(0);
    expect(imag[1]).toBeCloseTo(1);
  });

  it('builds the periodic wave from the current wave of the table', () => {
    const synthCore = createSynthCore();
    const createPeriodicWave = jest.spyOn(synthCore[0].audioCtx, 'createPeriodicWave');
    const [{ $periodicWave }, { setWaveTable, setCurrent }] = createOscillator(synthCore);

    setWaveTable([saw, square]);
    expect(periodic($periodicWave.value)).toEqual(spectrum(saw));
    // createPeriodicWave needs real and imag of the same length, at least 2
    const [realArg, imagArg] = createPeriodicWave.mock.calls.at(-1) as unknown as [number[], number[]];
    expect(realArg).toHaveLength(imagArg.length);
    expect(realArg.length).toBeGreaterThanOrEqual(2);

    setCurrent(1);
    expect(periodic($periodicWave.value)).toEqual(spectrum(square));
  });

  it('rebuilds the periodic wave when the current wave is edited', () => {
    const [{ $periodicWave, $waveTable }, { setWaveTable }] = createOscillator();
    setWaveTable([saw]);

    $waveTable.value[0].next(square);

    expect(periodic($periodicWave.value)).toEqual(spectrum(square));
  });

  it('clamps the current wave index when a shorter table is set', () => {
    const [{ $current, $periodicWave }, { setWaveTable, setCurrent }] = createOscillator();
    setWaveTable([saw, square, saw]);
    setCurrent(2);

    setWaveTable([square, saw]);

    expect($current.value).toBe(1);
    expect(periodic($periodicWave.value)).toEqual(spectrum(saw));
  });

  it('falls back to a default wave when the index is out of the table', () => {
    const [{ $periodicWave }, { setWaveTable, setCurrent }] = createOscillator();
    setWaveTable([saw]);
    setCurrent(5);
    expect(periodic($periodicWave.value)).toEqual(spectrum(placeholder));
  });

  it('applies the gain to the gain node', () => {
    const [{ gainNode }, { setGain }] = createOscillator();
    expect(gainNode.gain.value).toBe(0.5);
    setGain(0.2);
    expect(gainNode.gain.setValueAtTime).toHaveBeenLastCalledWith(0.2, 0);
    expect(gainNode.gain.value).toBeCloseTo(0.2);
  });

  it('updates settings through actions', () => {
    const [model, actions] = createOscillator();
    actions.setOscValue('unison', 5);
    actions.toggleActive();
    actions.setWaveTablePath(['a', 'b']);
    expect(model.$osc.value.unison).toBe(5);
    expect(model.$active.value).toBe(false);
    expect(model.$waveTablePath.value).toEqual(['a', 'b']);
  });

  it('gives every oscillator its own id', () => {
    const synthCore = createSynthCore();
    const [first] = createOscillator(synthCore, 'osc1');
    const [second] = createOscillator(synthCore, 'osc2');
    expect(first.id).not.toBe(second.id);
  });

  describe('wavetable loading', () => {
    // retries wait on rxjs timers (setInterval), flush stays on the real setTimeout
    beforeEach(() => jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout'] }));
    afterEach(() => jest.useRealTimers());

    it('loads the table of the initial path', async () => {
      const { model, load, resolve, table, audioCtx } = createLoading(['folder', 'a.wav']);
      expect(load).toHaveBeenCalledWith(audioCtx, 'a.wav');
      expect(model.$waveTableLoading.value).toBe(true);

      await resolve('a.wav', [saw, square]);

      expect(table()).toEqual([saw, square]);
      expect(periodic(model.$periodicWave.value)).toEqual(spectrum(saw));
      expect(model.$waveTableLoading.value).toBe(false);
    });

    it('loads the table of an applied preset without any component', async () => {
      const { model, load, resolve, table } = createLoading();
      await resolve('a.wav', [saw]);

      applySnapshot({ osc1: { p: ['folder', 'b.wav'], w: 1 } });

      expect(load).toHaveBeenLastCalledWith(expect.anything(), 'b.wav');
      expect(model.$waveTableLoading.value).toBe(true);
      await resolve('b.wav', [saw, square]);
      expect(table()).toEqual([saw, square]);
      expect(model.$current.value).toBe(1);
      expect(periodic(model.$periodicWave.value)).toEqual(spectrum(square));
      expect(model.$waveTableLoading.value).toBe(false);
    });

    it('loads the table of a selected path', async () => {
      const { actions, load, resolve, table } = createLoading();
      actions.setWaveTablePath(['folder', 'b.wav']);
      expect(load).toHaveBeenLastCalledWith(expect.anything(), 'b.wav');
      await resolve('b.wav', [square]);
      expect(table()).toEqual([square]);
    });

    it('keeps the edited waves when the same path is applied again', async () => {
      const { model, load, resolve, table } = createLoading();
      await resolve('a.wav', [saw]);
      model.$waveTable.value[0].next(square);

      applySnapshot({ osc1: { p: ['folder', 'a.wav'] } });
      await flush();

      expect(load).toHaveBeenCalledTimes(1);
      expect(table()).toEqual([square]);
      expect(model.$waveTableLoading.value).toBe(false);
    });

    it('ignores a load that finishes after a newer path was set', async () => {
      const { model, actions, resolve, table } = createLoading();
      actions.setWaveTablePath(['folder', 'b.wav']);

      await resolve('a.wav', [saw]);
      expect(table()).toEqual([placeholder]);
      expect(model.$waveTableLoading.value).toBe(true);

      await resolve('b.wav', [square]);
      expect(table()).toEqual([square]);
      expect(model.$waveTableLoading.value).toBe(false);
    });

    it('retries a failed load twice, a second apart', async () => {
      const { model, load, reject, resolve, table } = createLoading();

      await reject('a.wav');
      jest.advanceTimersByTime(999);
      expect(load).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(1);
      expect(load).toHaveBeenCalledTimes(2);
      expect(model.$waveTableLoading.value).toBe(true);

      await reject('a.wav');
      jest.advanceTimersByTime(1000);
      expect(load).toHaveBeenCalledTimes(3);

      await resolve('a.wav', [saw]);
      expect(table()).toEqual([saw]);
      expect(model.$waveTableLoading.value).toBe(false);
    });

    it('keeps the previous table when a load fails and loads the path again when it is applied', async () => {
      const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const { model, actions, load, resolve, fail, table } = createLoading();
      await resolve('a.wav', [saw]);

      actions.setWaveTablePath(['folder', 'b.wav']);
      await fail('b.wav');

      expect(load).toHaveBeenCalledTimes(4);
      expect(table()).toEqual([saw]);
      expect(model.$waveTableLoading.value).toBe(false);
      expect(error).toHaveBeenCalledTimes(1);

      applySnapshot({ osc1: { p: ['folder', 'b.wav'] } });
      expect(load).toHaveBeenCalledTimes(5);
      await resolve('b.wav', [square]);
      expect(table()).toEqual([square]);
      error.mockRestore();
    });

    it('stops loading when the model stops', async () => {
      const { resolve, table, load } = createLoading();
      stopModels();
      await resolve('a.wav', [saw]);
      expect(load).toHaveBeenCalledTimes(1);
      expect(table()).toEqual([placeholder]);
    });
  });

  describe('snapshot', () => {
    it('exposes the persisted state', () => {
      const [, actions] = createOscillator();
      actions.setOscValue('octave', -2);
      actions.setGain(0.7);
      actions.setCurrent(3);
      actions.setWaveTablePath(['a', 1]);

      expect(getSnapshot()['osc1']).toEqual({
        a: true,
        p: ['a', '1'],
        w: 3,
        o: -2,
        d: 5,
        u: 2,
        r: 0,
        g: 0.7,
      });
    });

    it('applies falsy values', () => {
      const [model] = createOscillator();
      model.$current.next(2);
      applySnapshot({ osc1: { a: false, w: 0, g: 0, o: 0, d: 0, u: 1, r: 0 } });

      expect(model.$active.value).toBe(false);
      expect(model.$current.value).toBe(0);
      expect(model.$gain.value).toBe(0);
      expect(model.$osc.value).toEqual({ octave: 0, detune: 0, unison: 1, randPhase: 0 });
    });

    it('restores default settings for missing keys and keeps the wavetable', () => {
      const [model, actions] = createOscillator();
      actions.setOscValue('detune', 50);
      actions.setGain(0.9);

      applySnapshot({});

      expect(model.$osc.value).toEqual({ octave: 0, detune: 5, unison: 2, randPhase: 0 });
      expect(model.$gain.value).toBe(0.9);
      expect(model.$waveTablePath.value).toEqual(['default']);
    });
  });
});
