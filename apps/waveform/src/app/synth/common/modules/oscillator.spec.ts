import { firstValueFrom } from 'rxjs';
import { applySnapshot, getSnapshot } from '../../../app';
import { createOscillator, createSynthCore, stopModels } from '../../../../test-utils/models';
import type { Wavetable } from '../../services';

const saw = [-1, -0.5, 0, 0.5];
const square = [1, 1, -1, -1];
// one sine cycle, played until a table loads
const placeholder = [0, 1, 0, -1];

const flush = () => new Promise((resolve) => setTimeout(resolve));

// an oscillator whose wavetable loads stay pending until the test settles them, the latest one per id
const createLoading = (initialWavePath = ['folder', 'a.wav']) => {
  const loads = new Map<string, { resolve: (table: Wavetable) => void; reject: (error: Error) => void }>();
  const load = jest.fn(
    (id: string) => new Promise<Wavetable>((resolve, reject) => loads.set(id, { resolve, reject }))
  );
  const synthCore = createSynthCore();
  const [model, actions] = createOscillator(synthCore, 'osc1', { active: true, initialWavePath }, load);
  const resolve = async (id: string, table: number[][], morph = false) => {
    loads.get(id)?.resolve({ frames: table, morph });
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
  return { model, actions, load, resolve, reject, fail, table };
};

describe('oscillator', () => {
  it('starts with the initial state', () => {
    const [model] = createOscillator(undefined, 'osc1', {
      active: false,
      initialWavePath: ['folder', 'file.wav'],
    });
    expect(model.$active.value).toBe(false);
    expect(model.$waveTablePath.value).toEqual(['folder', 'file.wav']);
    expect(model.$osc.value).toEqual({
      unison: 2,
      detune: 5,
      phase: 0.5,
      phaseRand: 1,
      octave: 0,
      semi: 0,
      fine: 0,
    });
    expect(model.$waveTable.value.map(({ value }) => value)).toEqual([placeholder]);
    expect(model.$position.value).toBe(0);
  });

  it('gives the voices the base of their params: position share, pitch in cents, detune, gain', () => {
    const [{ $params }, { setWaveTable, setPosition, setOscValue, setGain }] = createOscillator();
    expect($params.value).toEqual({ position: 0, detune: 0, spread: 5, gain: 0.5 });

    setWaveTable([saw, square, saw, square, saw]);
    setPosition(1);
    setOscValue('octave', -2);
    setOscValue('detune', 30);
    setGain(0.2);

    expect($params.value).toEqual({ position: 0.25, detune: -2400, spread: 30, gain: 0.2 });
  });

  it('pitches the oscillator by Oct, Semi and Fine: 1200·Oct + 100·Semi + Fine cents', () => {
    const [{ $params }, { setOscValue }] = createOscillator();
    setOscValue('semi', 7);
    setOscValue('fine', -7);
    expect($params.value.detune).toBe(693);
    setOscValue('octave', -1);
    expect($params.value.detune).toBe(-507);
    setOscValue('semi', -12);
    setOscValue('fine', 100);
    expect($params.value.detune).toBe(-2300);
  });

  it('plays a table of one frame at position 0', () => {
    const [{ $params }, { setWaveTable, setPosition }] = createOscillator();
    setWaveTable([saw]);
    setPosition(3);
    expect($params.value.position).toBe(0);
  });

  it('keeps the position within a shorter table', () => {
    const [{ $position, $params }, { setWaveTable, setPosition }] = createOscillator();
    setWaveTable([saw, square, saw]);
    setPosition(2);

    setWaveTable([square, saw]);

    expect($position.value).toBe(1);
    expect($params.value.position).toBe(1);
  });

  it('gives the editors the frame nearest to the position, within the table', async () => {
    const [{ $wave }, { setWaveTable, setPosition }] = createOscillator();
    setWaveTable([saw, square]);
    setPosition(0.6);
    expect(await firstValueFrom($wave)).toEqual(square);
    setPosition(5);
    expect(await firstValueFrom($wave)).toEqual(square);
  });

  it('of a table played expanded, the frame of the table nearest to the position among the 256', async () => {
    const [{ $wave }, { setWaveTable, setPosition }] = createOscillator();
    setWaveTable([saw, square, saw], true);
    // its frames at 0, 128 and 255
    setPosition(60);
    expect(await firstValueFrom($wave)).toEqual(saw);
    setPosition(100);
    expect(await firstValueFrom($wave)).toEqual(square);
    setPosition(200);
    expect(await firstValueFrom($wave)).toEqual(saw);
  });

  it('gives the editors only the edits of the frame the position is on now', () => {
    const [{ $wave, $waveTable }, { setWaveTable, setPosition }] = createOscillator();
    setWaveTable([saw, square]);
    const waves: number[][] = [];
    const subscription = $wave.subscribe((wave) => waves.push(wave));
    setPosition(1);
    setPosition(0);
    setPosition(1);
    waves.length = 0;

    // a frame it has left, then the one it is on
    $waveTable.value[0].next(square);
    $waveTable.value[1].next(saw);

    expect(waves).toEqual([saw]);
    subscription.unsubscribe();
  });

  it('gives the editors nothing for a step within the frame it is on', () => {
    const [{ $wave }, { setWaveTable, setPosition }] = createOscillator();
    setWaveTable([saw, square, saw], true);
    const waves: number[][] = [];
    const subscription = $wave.subscribe((wave) => waves.push(wave));
    waves.length = 0;
    // all nearest to its first frame (at 0 of the 256)
    setPosition(10);
    setPosition(20);
    expect(waves).toEqual([]);
    subscription.unsubscribe();
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

  describe('table delivery', () => {
    const setup = () => {
      const synthCore = createSynthCore();
      const setTable = jest.spyOn(synthCore[0].wavetables, 'setTable');
      const removeTable = jest.spyOn(synthCore[0].wavetables, 'removeTable');
      const oscillator = createOscillator(synthCore);
      return { oscillator, setTable, removeTable };
    };

    it('sends its table to the wavetable oscillator under its id, a new one at once', () => {
      const { oscillator, setTable } = setup();
      const [model, actions] = oscillator;
      expect(setTable).toHaveBeenLastCalledWith(model.id, [placeholder], false);
      actions.setWaveTable([saw, square]);
      expect(setTable).toHaveBeenLastCalledWith(model.id, [saw, square], false);
    });

    it('sends an edited table at most every 100 ms, the last edit too', () => {
      jest.useFakeTimers();
      const { oscillator, setTable } = setup();
      const [model, actions] = oscillator;
      actions.setWaveTable([saw, square]);
      jest.advanceTimersByTime(100);
      setTable.mockClear();

      model.$waveTable.value[0].next(square);
      model.$waveTable.value[0].next(placeholder);
      model.$waveTable.value[1].next(saw);
      expect(setTable).toHaveBeenCalledTimes(1);
      expect(setTable).toHaveBeenLastCalledWith(model.id, [square, square], false);
      jest.advanceTimersByTime(100);
      expect(setTable).toHaveBeenCalledTimes(2);
      expect(setTable).toHaveBeenLastCalledWith(model.id, [placeholder, saw], false);
      jest.useRealTimers();
    });

    it("follows the state of its table, another oscillator's aside; Retry sends it again", async () => {
      const synthCore = createSynthCore();
      const { wavetables } = synthCore[0];
      const retryTable = jest.spyOn(wavetables, 'retryTable');
      const [model, actions] = createOscillator(synthCore);
      const states: unknown[] = [];
      model.$tableState.subscribe((state) => states.push(state));
      await flush();
      wavetables.$tables.next({ ...wavetables.$tables.value, other: 'refused' });
      wavetables.$tables.next({ ...wavetables.$tables.value, [model.id]: 'refused' });
      actions.retryTable();
      expect(retryTable).toHaveBeenCalledWith(model.id);
      // (sent again)
      expect(states).toEqual([null, 'sending', 'refused', 'sending']);
    });

    it('removes its table when it stops', () => {
      const { oscillator, removeTable } = setup();
      stopModels();
      expect(removeTable).toHaveBeenCalledWith(oscillator[0].id);
    });
  });

  describe('wavetable loading', () => {
    // retries wait on rxjs timers (setInterval), flush stays on the real setTimeout
    beforeEach(() => jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout'] }));
    afterEach(() => jest.useRealTimers());

    it('loads the table of the initial path', async () => {
      const { model, load, resolve, table } = createLoading(['folder', 'a.wav']);
      expect(load).toHaveBeenCalledWith('a.wav');
      expect(model.$waveTableLoading.value).toBe(true);

      await resolve('a.wav', [saw, square]);

      expect(table()).toEqual([saw, square]);
      expect(model.$waveTableLoading.value).toBe(false);
    });

    it('loads the table of an applied preset without any component', async () => {
      const { model, load, resolve, table } = createLoading();
      await resolve('a.wav', [saw]);

      applySnapshot({ osc1: { p: ['folder', 'b.wav'], w: 1 } });

      expect(load).toHaveBeenLastCalledWith('b.wav');
      expect(model.$waveTableLoading.value).toBe(true);
      await resolve('b.wav', [saw, square]);
      expect(table()).toEqual([saw, square]);
      expect(model.$position.value).toBe(1);
      expect(model.$params.value.position).toBe(1);
      expect(model.$waveTableLoading.value).toBe(false);
    });

    it('loads the table of a selected path', async () => {
      const { actions, load, resolve, table } = createLoading();
      actions.setWaveTablePath(['folder', 'b.wav']);
      expect(load).toHaveBeenLastCalledWith('b.wav');
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
      actions.setOscValue('semi', 7);
      actions.setOscValue('fine', -7);
      actions.setOscValue('phase', 0.25);
      actions.setOscValue('phaseRand', 0.5);
      actions.setGain(0.7);
      actions.setPosition(3);
      actions.setWaveTablePath(['a', 1]);

      expect(getSnapshot()['osc1']).toEqual({
        a: true,
        p: ['a', '1'],
        w: 3,
        o: -2,
        s: 7,
        f: -7,
        d: 5,
        u: 2,
        ph: 0.25,
        pr: 0.5,
        g: 0.7,
      });
    });

    it('keeps a position between two frames', () => {
      const [model, actions] = createOscillator();
      actions.setWaveTable([saw, square, saw]);
      actions.setPosition(1.25);
      expect(getSnapshot()['osc1']).toMatchObject({ w: 1.25 });
      model.$position.next(0);
      applySnapshot({ osc1: { w: 0.75 } });
      expect(model.$position.value).toBe(0.75);
      expect(model.$params.value.position).toBe(0.375);
    });

    it('applies falsy values', () => {
      const [model, actions] = createOscillator();
      model.$position.next(2);
      actions.setOscValue('phase', 0.5);
      actions.setOscValue('phaseRand', 0.5);
      actions.setOscValue('semi', 5);
      actions.setOscValue('fine', 5);
      applySnapshot({ osc1: { a: false, w: 0, g: 0, o: 0, s: 0, f: 0, d: 0, u: 1, ph: 0, pr: 0 } });

      expect(model.$active.value).toBe(false);
      expect(model.$position.value).toBe(0);
      expect(model.$gain.value).toBe(0);
      expect(model.$osc.value).toEqual({
        octave: 0,
        semi: 0,
        fine: 0,
        detune: 0,
        unison: 1,
        phase: 0,
        phaseRand: 0,
      });
    });

    it('restores default settings for missing keys and keeps the wavetable', () => {
      const [model, actions] = createOscillator();
      actions.setOscValue('detune', 50);
      actions.setOscValue('semi', 7);
      actions.setOscValue('fine', -7);
      actions.setOscValue('phase', 0.25);
      actions.setGain(0.9);

      applySnapshot({});

      expect(model.$osc.value).toEqual({
        octave: 0,
        semi: 0,
        fine: 0,
        detune: 5,
        unison: 2,
        phase: 0.5,
        phaseRand: 1,
      });
      expect(model.$params.value.detune).toBe(0);
      expect(model.$gain.value).toBe(0.9);
      expect(model.$waveTablePath.value).toEqual(['default']);
    });

    it('plays a snapshot saved before Semi and Fine (a legacy url) at its octave, takes theirs', () => {
      const [model, actions] = createOscillator();
      actions.setOscValue('semi', 3);
      actions.setOscValue('fine', 3);
      applySnapshot({ osc1: { o: 1, d: 10 } });
      expect(model.$osc.value).toMatchObject({ octave: 1, semi: 0, fine: 0, detune: 10 });
      expect(model.$params.value.detune).toBe(1200);
      applySnapshot({ osc1: { o: -1, s: 7, f: -7 } });
      expect(model.$params.value.detune).toBe(-507);
    });

    it('reads the Phase rand of a legacy snapshot from r (a start delay up to 2 ms), writes only pr', () => {
      const [model] = createOscillator();
      applySnapshot({ osc1: { r: 0.0005 } });
      expect(model.$osc.value.phaseRand).toBe(0.25);
      applySnapshot({ osc1: { r: 0.004 } });
      expect(model.$osc.value.phaseRand).toBe(1);
      // pr wins
      applySnapshot({ osc1: { r: 0.002, pr: 0 } });
      expect(model.$osc.value.phaseRand).toBe(0);
      expect(getSnapshot()['osc1']).not.toHaveProperty('r');
    });

    it('keeps a legacy snapshot (r without pr) at the phase it played from, 0, not the default', () => {
      const [model] = createOscillator();
      applySnapshot({ osc1: { r: 0 } });
      expect(model.$osc.value.phase).toBe(0);
      applySnapshot({ osc1: { r: 0, ph: 0.25 } });
      expect(model.$osc.value.phase).toBe(0.25);
      // with pr it is not legacy
      applySnapshot({ osc1: { r: 0, pr: 0 } });
      expect(model.$osc.value.phase).toBe(0.5);
    });
  });

  describe('the wave of the chart', () => {
    const latest = (osc: ReturnType<typeof createOscillator>) => {
      let wave: number[] = [];
      osc[0].$playedWave.subscribe((value) => (wave = value)).unsubscribe();
      return wave;
    };

    it('plays one frame, never a mix of two: the one the voices play (ceil(share × frames) - 1)', () => {
      const osc = createOscillator();
      osc[1].setWaveTable([saw, square, saw]);
      osc[1].setPosition(0.9);
      expect(latest(osc)).toEqual(square);
      osc[1].setPosition(1);
      expect(latest(osc)).toEqual(square);
      osc[1].setPosition(1.4);
      expect(latest(osc)).toEqual(saw);
    });

    // the app threw it: $frames follows the table after the chart saw the new table with the old count
    it('stays whole while a table with a morph replaces the one it shows (a subscriber, as the chart)', () => {
      const osc = createOscillator();
      const errors: unknown[] = [];
      const waves: number[][] = [];
      const subscription = osc[0].$playedWave.subscribe({
        next: (wave) => waves.push(wave),
        error: (e) => errors.push(e),
      });
      osc[1].setWaveTable([saw, square, saw], true);
      osc[1].setWaveTable([square], false);
      osc[1].setWaveTable([saw, square], true);
      subscription.unsubscribe();
      expect(errors).toEqual([]);
      expect(waves[waves.length - 1]).toEqual(saw);
    });

    it('of a table with a morph plays the crossfades of its frames: 256 frames, the knob over them', () => {
      const osc = createOscillator();
      osc[1].setWaveTable([saw, square], true);
      expect(osc[0].$frames.value).toBe(256);
      // frame 0 and 255 are the frames of the table, frame 1 the share 2 / 256 of the next one
      osc[1].setPosition(0);
      expect(latest(osc)).toEqual(saw);
      osc[1].setPosition(255);
      expect(latest(osc)).toEqual(square);
      osc[1].setPosition(1);
      latest(osc).forEach((value, i) =>
        expect(value).toBeCloseTo((254 / 256) * saw[i] + (2 / 256) * square[i])
      );
      // the voices get the share of the knob
      expect(osc[0].$params.value.position).toBe(1 / 255);
    });

    it('follows an edited frame', () => {
      const osc = createOscillator();
      osc[1].setWaveTable([saw, square]);
      osc[0].$waveTable.value[0].next(square);
      expect(latest(osc)).toEqual(square);
    });
  });
});
