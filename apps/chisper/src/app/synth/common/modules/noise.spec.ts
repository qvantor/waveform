import { applySnapshot, getSnapshot } from '../../../app';
import { createNoise, createSynthCore, stopModels } from '../../../../test-utils/models';
import type { NoiseSample } from '../../services';
import type { TableState } from '../wavetable/wavetable-engine';

const flush = () => new Promise((resolve) => setTimeout(resolve));
const SAMPLE: NoiseSample = { channels: [Float32Array.of(0.5, -0.5, 0.25)], sampleRate: 44100 };

// a noise whose loads stay pending until the test settles them, the latest one per key
const createLoading = () => {
  const loads = new Map<string, { resolve: (sample: NoiseSample) => void; reject: (error: Error) => void }>();
  const load = jest.fn(
    (key: string) => new Promise<NoiseSample>((resolve, reject) => loads.set(key, { resolve, reject }))
  );
  const synthCore = createSynthCore();
  const { wavetables } = synthCore[0];
  const setSample = jest.spyOn(wavetables, 'setSample');
  const [model, actions] = createNoise(synthCore, load);
  const resolve = async (key: string, sample = SAMPLE) => {
    loads.get(key)?.resolve(sample);
    await flush();
  };
  const reject = async (key: string) => {
    loads.get(key)?.reject(new Error('404'));
    await flush();
  };
  return { model, actions, load, resolve, reject, setSample, wavetables };
};

describe('noise', () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['setTimeout'] }));
  afterEach(() => {
    stopModels();
    jest.useRealTimers();
  });

  it('starts off: a white noise looped from its start at -24 dB, in the centre, Pitch Track off', () => {
    const [model] = createNoise();
    expect(model.$active.value).toBe(false);
    expect(model.$samplePath.value).toEqual(['Analog', 'Analog/White.wav']);
    expect(model.$noise.value).toEqual({
      loop: true,
      keytrack: false,
      start: 0,
      rand: 0,
      pitch: 0,
      fine: 0,
      pan: 0,
      level: 0.25,
    });
    expect(model.voiceNoise()).toBeNull();
  });

  describe('its sample', () => {
    it('loads only while it is on, then goes to the wavetable oscillator under the id of the model', async () => {
      const { model, actions, load, resolve, setSample } = createLoading();
      await flush();
      expect(load).not.toHaveBeenCalled();
      actions.toggleActive();
      expect(load).toHaveBeenCalledWith('Analog/White.wav');
      expect(model.$sampleLoading.value).toBe(true);
      expect(model.samplePlayed()).toBe(false);
      await resolve('Analog/White.wav');
      expect(setSample).toHaveBeenCalledWith(model.id, SAMPLE.channels, 44100);
      expect(model.$sample.value).toBe(SAMPLE);
      expect(model.$sampleLoading.value).toBe(false);
    });

    it('loads a new path while on; off, the sample stays and the next path waits for it to be on', async () => {
      const { actions, load, resolve } = createLoading();
      actions.toggleActive();
      await resolve('Analog/White.wav');
      actions.setSamplePath(['Textures', 'Textures/Rain.wav']);
      expect(load).toHaveBeenLastCalledWith('Textures/Rain.wav');
      await resolve('Textures/Rain.wav');
      actions.toggleActive();
      actions.setSamplePath(['Analog', 'Analog/Pink.wav']);
      await flush();
      expect(load).toHaveBeenCalledTimes(2);
      actions.toggleActive();
      expect(load).toHaveBeenLastCalledWith('Analog/Pink.wav');
      // switched on again on the same path: no load
      await resolve('Analog/Pink.wav');
      actions.toggleActive();
      actions.toggleActive();
      expect(load).toHaveBeenCalledTimes(3);
    });

    it('a newer path cancels the pending load', async () => {
      const { actions, resolve, setSample } = createLoading();
      actions.toggleActive();
      actions.setSamplePath(['Textures', 'Textures/Rain.wav']);
      await resolve('Analog/White.wav');
      expect(setSample).not.toHaveBeenCalled();
      await resolve('Textures/Rain.wav', { ...SAMPLE, sampleRate: 48000 });
      expect(setSample).toHaveBeenCalledTimes(1);
      expect(setSample.mock.calls[0][2]).toBe(48000);
    });

    it('retries a failed load twice a second apart, then gives up: the next switch on tries again', async () => {
      const { model, actions, load, reject } = createLoading();
      actions.toggleActive();
      for (let attempt = 0; attempt < 3; attempt++) {
        await reject('Analog/White.wav');
        jest.advanceTimersByTime(1000);
      }
      expect(load).toHaveBeenCalledTimes(3);
      expect(model.$sampleLoading.value).toBe(false);
      actions.toggleActive();
      actions.toggleActive();
      expect(load).toHaveBeenCalledTimes(4);
    });

    it('is played once loaded and stored (refused: the one before plays), Retry sends it again', async () => {
      const { model, actions, resolve, wavetables } = createLoading();
      const retryTable = jest.spyOn(wavetables, 'retryTable');
      actions.toggleActive();
      await resolve('Analog/White.wav');
      wavetables.$tables.next({ [model.id]: 'sending' });
      expect(model.samplePlayed()).toBe(false);
      wavetables.$tables.next({ [model.id]: 'refused' });
      expect(model.samplePlayed()).toBe(true);
      actions.retrySample();
      expect(retryTable).toHaveBeenCalledWith(model.id);
    });

    it('new notes play the latest one stored: none before, the one before while the next is on its way or refused', async () => {
      const { model, actions, resolve, wavetables } = createLoading();
      const sampleState = (state: TableState) =>
        wavetables.$tables.next({ ...wavetables.$tables.value, [model.id]: state });
      actions.toggleActive();
      await resolve('Analog/White.wav');
      sampleState('sending');
      expect(model.$playedSample.value).toBeNull();
      sampleState('stored');
      expect(model.$playedSample.value).toBe('Analog/White.wav');
      actions.setSamplePath(['Textures', 'Textures/Rain.wav']);
      // (loading)
      expect(model.$playedSample.value).toBe('Analog/White.wav');
      await resolve('Textures/Rain.wav');
      sampleState('sending');
      expect(model.$playedSample.value).toBe('Analog/White.wav');
      sampleState('refused');
      expect(model.$playedSample.value).toBe('Analog/White.wav');
      sampleState('failed');
      expect(model.$playedSample.value).toBe('Analog/White.wav');
      // sent again (Retry) and stored
      sampleState('sending');
      sampleState('stored');
      expect(model.$playedSample.value).toBe('Textures/Rain.wav');
    });

    it('is removed from the wavetable oscillator with the model', () => {
      const synthCore = createSynthCore();
      const removeTable = jest.spyOn(synthCore[0].wavetables, 'removeTable');
      const [model] = createNoise(synthCore);
      stopModels();
      expect(removeTable).toHaveBeenCalledWith(model.id);
    });
  });

  describe('the noise of a note', () => {
    it('is its sample, its switches and its knobs, the pitch in cents (100 · Pitch + Fine)', () => {
      const [model, actions] = createNoise();
      actions.toggleActive();
      actions.setLoop(false);
      actions.setKeytrack(true);
      actions.setNoiseValue('start', 0.3);
      actions.setNoiseValue('rand', 0.5);
      actions.setNoiseValue('pitch', -7);
      actions.setNoiseValue('fine', 25);
      actions.setNoiseValue('pan', -0.4);
      actions.setNoiseValue('level', 0.8);
      expect(model.voiceNoise()).toEqual({
        sample: model.id,
        loop: false,
        keytrack: true,
        start: 0.3,
        rand: 0.5,
        level: 0.8,
        pan: -0.4,
        cents: -675,
      });
      expect(model.$params.value).toEqual({ level: 0.8, pan: -0.4, cents: -675 });
    });

    it('changes what playing notes follow only on a change of the level, the pan or the pitch', () => {
      const [model, actions] = createNoise();
      const seen: unknown[] = [];
      model.$params.subscribe((params) => seen.push(params));
      actions.setNoiseValue('start', 0.5);
      actions.setLoop(false);
      actions.setNoiseValue('fine', 10);
      expect(seen).toEqual([
        { level: 0.25, pan: 0, cents: 0 },
        { level: 0.25, pan: 0, cents: 10 },
      ]);
    });
  });

  describe('snapshot', () => {
    it('exposes the persisted state', () => {
      const [, actions] = createNoise();
      actions.toggleActive();
      actions.setSamplePath(['Textures', 'Textures/Rain.wav']);
      actions.setLoop(false);
      actions.setKeytrack(true);
      actions.setNoiseValue('start', 0.3);
      actions.setNoiseValue('rand', 0.5);
      actions.setNoiseValue('pitch', 12);
      actions.setNoiseValue('fine', -30);
      actions.setNoiseValue('pan', 0.5);
      actions.setNoiseValue('level', 0.7);
      expect(getSnapshot()['noise']).toEqual({
        a: true,
        p: ['Textures', 'Textures/Rain.wav'],
        lp: false,
        kt: true,
        st: 0.3,
        rd: 0.5,
        s: 12,
        f: -30,
        pn: 0.5,
        g: 0.7,
      });
    });

    it('applies falsy values', () => {
      const [model, actions] = createNoise();
      actions.toggleActive();
      actions.setNoiseValue('start', 0.5);
      actions.setNoiseValue('pitch', 5);
      applySnapshot({ noise: { a: false, lp: false, kt: false, st: 0, rd: 0, s: 0, f: 0, pn: 0, g: 0 } });
      expect(model.$active.value).toBe(false);
      expect(model.$noise.value).toEqual({
        loop: false,
        keytrack: false,
        start: 0,
        rand: 0,
        pitch: 0,
        fine: 0,
        pan: 0,
        level: 0,
      });
    });

    it('restores the defaults for missing keys, the noise off', () => {
      const [model, actions] = createNoise();
      actions.toggleActive();
      actions.setSamplePath(['Textures', 'Textures/Rain.wav']);
      actions.setNoiseValue('level', 1);
      actions.setKeytrack(true);
      applySnapshot({});
      expect(model.$active.value).toBe(false);
      expect(model.$samplePath.value).toEqual(['Analog', 'Analog/White.wav']);
      expect(model.$noise.value).toMatchObject({ level: 0.25, keytrack: false, loop: true });
    });

    it('loads the sample of the path it applies only: on after the path, off before it', async () => {
      const { load, resolve } = createLoading();
      applySnapshot({ noise: { a: true, p: ['Textures', 'Textures/Rain.wav'] } });
      expect(load.mock.calls).toEqual([['Textures/Rain.wav']]);
      await resolve('Textures/Rain.wav');
      applySnapshot({ noise: { a: true, p: ['Analog', 'Analog/Pink.wav'] } });
      expect(load).toHaveBeenLastCalledWith('Analog/Pink.wav');
      await resolve('Analog/Pink.wav');
      // off with another path: none; on again on the path loaded: none
      applySnapshot({ noise: { a: false, p: ['Textures', 'Textures/Rain.wav'] } });
      applySnapshot({ noise: { a: true, p: ['Analog', 'Analog/Pink.wav'] } });
      expect(load).toHaveBeenCalledTimes(2);
    });

    it('round-trips its state', () => {
      const [model, actions] = createNoise();
      actions.toggleActive();
      actions.setNoiseValue('rand', 0.75);
      actions.setNoiseValue('pan', -1);
      const snapshot = getSnapshot();
      applySnapshot({});
      applySnapshot(snapshot);
      expect(getSnapshot()['noise']).toEqual(snapshot['noise']);
      expect(model.$active.value).toBe(true);
    });
  });
});
