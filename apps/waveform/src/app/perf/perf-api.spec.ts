import { registrar } from 'standardized-audio-context-mock';
import { createSynth, immediateSoundSwitch, initModel } from '../../test-utils/models';
import { withoutAudioWorklet } from '../../test-utils/no-audio-worklet';
import { WorkerStub } from '../../test-utils/worker-stub';
import { getSnapshot } from '../app';
import { presets } from '../presets/modules/presets';
import { LIMITER_PROCESSOR } from '../synth/common/processors';
import { STORE_PROCESSOR } from '../synth/common/wavetable/wavetable-osc-params';
import { voiceEvents } from '../../test-utils/voice-events';
import { fx } from '../synth/fx/modules/fx';
import { noteToString, Wavetable } from '../synth/services';
import { createPerfApi, PerfModels } from './perf-api';
import { PROBE_PROCESSOR } from './probe-dsp';

jest.mock('../presets/services', () => ({
  clearUrlPresetId: jest.fn(),
  getEditToken: jest.fn(),
  getPreset: jest.fn(),
  getTopPresets: jest.fn(() => Promise.resolve([])),
  getUrlPresetId: jest.fn(() => null),
  markPresetOpened: jest.fn(),
  setUrlPresetId: jest.fn(),
}));

interface NodeStub extends AudioWorkletNode {
  name: string;
  options: AudioWorkletNodeOptions;
  port: AudioWorkletNode['port'] & {
    postMessage: jest.Mock;
    onmessage: ((event: { data: unknown }) => void) | null;
  };
}
interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const deferred = <T>(): Deferred<T> => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

const TABLE = [
  [0, 1, 0, -1],
  [1, 0, -1, 0],
];
const WORKLET_STATS = { tables: 2, versions: 2, bytes: 4096, voices: 0, frame: 128 };
const BUILDER_STATS = { pending: 0, pooled: 0, pool: 0, builds: 1, lastMs: 1, totalMs: 1, maxMs: 1 };

const setup = async ({ ready = true } = {}) => {
  // the tables load when the test resolves them
  const loads = new Map<string, Deferred<Wavetable>>();
  const load = (id: string) => {
    if (!loads.has(id)) loads.set(id, deferred());
    return loads.get(id) as Deferred<Wavetable>;
  };
  const resolveTables = () => loads.forEach(({ resolve }) => resolve({ frames: TABLE, morph: false }));
  const modules = createSynth(['default'], (id) => load(id).promise);
  const fxModule = initModel(
    fx({
      synthCore: modules.synthCore,
      synth: modules.synth,
      lfo: modules.lfos,
      modulation: modules.modulation,
    }),
    'fx',
    undefined
  );
  const presetsModule = initModel(presets({ soundSwitch: immediateSoundSwitch() }), 'presets', undefined);
  const models = {
    synthCore: modules.synthCore,
    inputController: modules.inputController,
    env: modules.envelopes,
    mod: modules.modulation,
    osc1: modules.osc1,
    osc2: modules.osc2,
    filter: modules.filter,
    fx: fxModule,
    synth: modules.synth,
    presets: presetsModule,
  } as unknown as PerfModels;
  const api = createPerfApi(models);
  if (ready) await sleep(0);

  const [{ audioCtx, preGain, output }] = modules.synthCore;
  const nodes = (name: string) =>
    (registrar.getAudioNodes(audioCtx as never, 'AudioWorkletNode' as never) as unknown as NodeStub[]).filter(
      (node) => node.name === name
    );
  // the store acknowledges every build and both answer a stats request, as the worklet and the worker do
  const answerLikeTheWorklet = () => {
    const store = nodes(STORE_PROCESSOR).at(-1) as NodeStub;
    const worker = WorkerStub.created.at(-1) as WorkerStub;
    const toStore = (data: unknown) => queueMicrotask(() => store.port.onmessage?.({ data }));
    const onWorker = (message: { frames?: unknown; table: string; version: number; stats?: true }) => {
      if (message.frames) toStore({ stored: message.table, version: message.version });
      if (message.stats)
        queueMicrotask(() => worker.onmessage?.({ data: { stats: BUILDER_STATS } } as MessageEvent));
    };
    worker.postMessage.mock.calls.forEach(([message]) => onWorker(message));
    worker.postMessage.mockImplementation(onWorker);
    store.port.postMessage.mockImplementation((message: { stats?: true }) => {
      if (message.stats) toStore({ stats: WORKLET_STATS });
    });
  };
  return {
    api,
    modules,
    load,
    resolveTables,
    nodes,
    answerLikeTheWorklet,
    audioCtx,
    preGain,
    output,
    filterModule: modules.filter,
  };
};

describe('perf test hook api', () => {
  describe('ready', () => {
    it('waits for the tables to load and to be in the store', async () => {
      const { api, resolveTables, answerLikeTheWorklet } = await setup();
      let ready = false;
      const waiting = api.ready().then(() => (ready = true));
      await sleep(50);
      expect(ready).toBe(false);
      resolveTables();
      await sleep(50);
      // built, not acknowledged by the store yet
      expect(ready).toBe(false);
      answerLikeTheWorklet();
      await waiting;
      expect(ready).toBe(true);
    });

    it('rejects at once when the oscillator is unsupported', async () => {
      withoutAudioWorklet();
      const { api } = await setup();
      await expect(api.ready()).rejects.toThrow('The wavetable oscillator is unsupported');
    });

    // the master is silent without it: nothing to measure
    it('rejects at once when the limiter failed', async () => {
      const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const { api, nodes } = await setup();
      const [limiter] = nodes(LIMITER_PROCESSOR);
      limiter.onprocessorerror?.call(limiter, new Event('processorerror'));
      await expect(api.ready()).rejects.toThrow('The limiter is failed');
      error.mockRestore();
    });

    it('rejects after the timeout with what it waits for', async () => {
      const { api } = await setup();
      await expect(api.ready(60)).rejects.toThrow(/Not ready in 60 ms.*"loading":true/);
    });
  });

  it('applies a snapshot, the rest at the defaults, ready once its tables are stored', async () => {
    const { api, resolveTables, answerLikeTheWorklet, modules } = await setup();
    answerLikeTheWorklet();
    resolveTables();
    await api.ready();
    modules.synth[1].setMaxVoices(4);
    let applied = false;
    const applying = api
      .apply({ env: { e1: { attack: 0.5 } }, osc1: { u: 4, p: ['bench', 'new.wav'] } })
      .then(() => (applied = true));
    expect(getSnapshot()['env']).toMatchObject({ e1: { attack: 0.5 } });
    expect(getSnapshot()['osc1']).toMatchObject({ u: 4, p: ['bench', 'new.wav'] });
    expect(getSnapshot()['v']).toEqual({ leg: false, port: 0, max: 8, bd: 2, bu: 2 });
    await sleep(50);
    expect(applied).toBe(false);
    resolveTables();
    await applying;
    expect(applied).toBe(true);
  });

  describe('run', () => {
    it('plays and releases the notes of a script through the input controller, in their order', async () => {
      const { api, modules } = await setup();
      const events: string[] = [];
      const [{ $onPress, $onRelease }] = modules.inputController;
      $onPress.subscribe(({ note }) => events.push(`on ${noteToString(note)}`));
      $onRelease.subscribe((note) => events.push(`off ${noteToString(note)}`));
      await api.run([
        { at: 40, note: 'C4', on: false },
        { at: 0, note: 'C4', on: true },
        { at: 0, note: 'E4', on: true },
        { at: 20, note: 'G4', on: true },
      ]);
      expect(events).toEqual(['on C4', 'on E4', 'on G4', 'off C4']);
      const pressed = () => Object.values(modules.inputController[0].$pressed.value).flat().length;
      expect(pressed()).toBe(2);
      api.releaseAll();
      expect(pressed()).toBe(0);
      // released, they sound until their processors end them
      expect(modules.synth[0].$voicesCount.value).toBe(3);
    });

    it('stops the running scripts', async () => {
      const { api, modules } = await setup();
      const running = api.run([
        { at: 0, note: 'C4', on: true },
        { at: 80, note: 'E4', on: true },
      ]);
      await sleep(20);
      api.stopRuns();
      await running;
      expect(modules.synth[0].$voicesCount.value).toBe(1);
    });
  });

  it('tells the context and the counters of the engine', async () => {
    const { api, answerLikeTheWorklet, audioCtx } = await setup();
    answerLikeTheWorklet();
    const stats = await api.stats();
    expect(stats.context).toEqual({
      state: audioCtx.state,
      sampleRate: audioCtx.sampleRate,
      currentTime: audioCtx.currentTime,
    });
    expect(stats.engine).toEqual({ worklet: WORKLET_STATS, worker: BUILDER_STATS });
  });

  describe('trace', () => {
    it('times a note from its input event to the start of its voice and the onsets of the probe', async () => {
      const { api, modules, nodes, answerLikeTheWorklet, resolveTables, audioCtx } = await setup();
      answerLikeTheWorklet();
      resolveTables();
      await api.ready();
      await api.probe.install('/perf/probe.js');
      const [probe] = nodes(PROBE_PROCESSOR);
      api.trace.start();
      // a key handler of the app plays the note while the event is dispatched
      const [, { onPress }] = modules.inputController;
      const play = () => onPress([4, 'A']);
      document.addEventListener('keydown', play);
      document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyY', bubbles: true }));
      document.removeEventListener('keydown', play);
      const [{ audioCtx: context, wavetables }] = modules.synthCore;
      const { voices, started } = voiceEvents(context, wavetables);
      started(voices()[0], 140, 128);
      probe.port.onmessage?.({ data: { onset: 150, input: 0 } });
      probe.port.onmessage?.({ data: { onset: 260, input: 1 } });
      const { notes } = api.trace.stop();
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatchObject({
        note: 'A4',
        lost: false,
        event: { type: 'keydown' },
        scheduled: 128,
        started: 140,
        onsets: [150, 260],
      });
      // the capture listener got it, on the clock of performance.now() (jsdom stamps events from the epoch)
      expect(notes[0].toHandler).toBeGreaterThanOrEqual(0);
      expect(notes[0].toHandler).toBeLessThan(1000);
      expect(notes[0].dsp).toBeCloseTo((110 / audioCtx.sampleRate) * 1000);
      // tracing has stopped: new voices are not traced
      expect(modules.synth[0].$voiceStarts.observed).toBe(false);
    });

    it('times an event without a usable time stamp from its capture', async () => {
      const { api, modules } = await setup();
      api.trace.start();
      const [, { onPress }] = modules.inputController;
      const play = () => onPress([4, 'A']);
      document.addEventListener('keydown', play);
      // off by more than an hour on both clocks (WebKit stamped its synthesized pointer events from 2001)
      const event = new Event('keydown', { bubbles: true });
      Object.defineProperty(event, 'timeStamp', { value: 8.124e11 });
      document.body.dispatchEvent(event);
      document.removeEventListener('keydown', play);
      const [note] = api.trace.stop().notes;
      expect(note.event).toMatchObject({ type: 'keydown', estimated: true });
      expect(note.event?.timeStamp).toBe(note.handled);
      expect(note.toHandler).toBe(0);
    });

    it('marks a note played before the oscillator is ready as lost', async () => {
      const { api, modules } = await setup({ ready: false });
      api.trace.start();
      modules.inputController[1].onPress([4, 'C']);
      const { notes } = api.trace.stop();
      expect(notes[0]).toMatchObject({ note: 'C4', lost: true, event: null, started: null });
    });

    it('records the releases', async () => {
      const { api, modules } = await setup();
      const [, { onPress, onRelease }] = modules.inputController;
      api.trace.start();
      onPress([4, 'C']);
      onRelease([4, 'C']);
      expect(api.trace.stop().releases).toEqual([expect.objectContaining({ note: 'C4', event: null })]);
    });
  });

  it('taps the voices (the filter is in each) and the output', async () => {
    const { api, nodes, audioCtx, preGain, output } = await setup();
    await api.probe.install('/perf/probe.js');
    const [probe] = nodes(PROBE_PROCESSOR);
    expect(audioCtx.audioWorklet.addModule).toHaveBeenCalledWith('/perf/probe.js');
    expect(probe.options).toMatchObject({ numberOfInputs: 2, numberOfOutputs: 1 });
    expect(output.connect).toHaveBeenCalledWith(probe, 0, 1);
    expect(probe.connect).toHaveBeenCalledWith(audioCtx.destination);
    expect(preGain.connect).toHaveBeenCalledWith(probe, 0, 0);

    api.destroy();
    expect(probe.port.postMessage).toHaveBeenCalledWith({ stop: true });
    expect(preGain.disconnect).toHaveBeenCalledWith(probe);
    expect(output.disconnect).toHaveBeenCalledWith(probe);
  });

  it('installs one probe however many installs are asked at once, none once destroyed meanwhile', async () => {
    const { api, nodes, audioCtx } = await setup();
    await Promise.all([api.probe.install('/perf/probe.js'), api.probe.install('/perf/probe.js')]);
    expect(nodes(PROBE_PROCESSOR)).toHaveLength(1);
    expect(audioCtx.audioWorklet.addModule).toHaveBeenCalledWith('/perf/probe.js');
    api.destroy();
    const installing = api.probe.install('/perf/probe.js');
    api.destroy();
    await installing;
    expect(nodes(PROBE_PROCESSOR)).toHaveLength(1);
  });

  it('destroy stops the trace, the scripts and the probe', async () => {
    const { api, modules, nodes } = await setup();
    await api.probe.install('/perf/probe.js');
    const [probe] = nodes(PROBE_PROCESSOR);
    api.trace.start();
    api.destroy();
    expect(probe.port.postMessage).toHaveBeenCalledWith({ stop: true });
    expect(modules.synth[0].$voiceStarts.observed).toBe(false);
  });
});
