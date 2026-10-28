import { registrar } from 'standardized-audio-context-mock';
import { withoutAudioWorklet } from '../../../../test-utils/no-audio-worklet';
import { workletLoads } from '../../../../test-utils/worklet-loads';
import { MessageChannelStub, WorkerStub } from '../../../../test-utils/worker-stub';
import { LfoWire, lfoTable, RETRIG } from '../lfo/lfo-curve';
import { createWavetableEngine, WavetableStatus } from './wavetable-engine';
import { STORE_PROCESSOR, VOICES_PROCESSOR } from './wavetable-osc-params';
import type { VoiceOptions } from './voice-options';

interface NodeStub extends AudioWorkletNode {
  name: string;
  options: AudioWorkletNodeOptions;
  port: AudioWorkletNode['port'] & { postMessage: jest.Mock };
}

// the module loads asynchronously
const flush = () => new Promise((resolve) => setTimeout(resolve));
const createChannel = () => new MessageChannelStub() as unknown as MessageChannel;

const setup = ({ failFirstLoad = false } = {}) => {
  const audioCtx = new AudioContext();
  // (no audioWorklet without AudioWorklet)
  const addModule = audioCtx.audioWorklet?.addModule as jest.Mock;
  if (failFirstLoad) addModule.mockRejectedValueOnce(new Error('404'));
  // the input the voices play into
  const output = audioCtx.createGain();
  const engine = createWavetableEngine(audioCtx, output, { createChannel });
  const statuses: WavetableStatus[] = [];
  engine.$status.subscribe((status) => statuses.push(status));
  const worker = () => WorkerStub.created.at(-1);
  // the frames of the build messages posted to the worker
  const builds = () =>
    (worker()?.postMessage.mock.calls ?? [])
      .map(([message]) => message)
      .filter((message) => 'frames' in message);
  // the store node and what it posts to the main thread: an ack of a version, its counters
  const nodes = (name: string) =>
    (registrar.getAudioNodes(audioCtx as never, 'AudioWorkletNode' as never) as unknown as NodeStub[]).filter(
      (node) => node.name === name
    );
  const store = () => nodes(STORE_PROCESSOR).at(-1);
  // the voices node, the events posted to it
  const voices = () => nodes(VOICES_PROCESSOR).at(-1);
  const events = (node = voices()) =>
    (node?.port.postMessage.mock.calls ?? []).flatMap(([message]) => message.events ?? []);
  const fromStore = (data: unknown, node = store()) => node?.port.onmessage?.({ data } as MessageEvent);
  const ack = (table: string, version: number) => fromStore({ stored: table, version });
  // both answers to a stats request
  const answer = (worklet: unknown, builder: unknown) => {
    fromStore({ stats: worklet });
    worker()?.onmessage?.({ data: { stats: builder } } as MessageEvent);
  };
  return {
    audioCtx,
    addModule,
    output,
    engine,
    statuses,
    worker,
    builds,
    store,
    voices,
    events,
    fromStore,
    ack,
    answer,
  };
};

const NOTE: VoiceOptions = {
  osc: [{ table: 'osc1', unison: 2, phase: 0, phaseRand: 0 }, null],
  start: 1,
  envelopes: [{ attack: 0, hold: 0, decay: 0, sustain: 1, release: 0.1 }],
  envStart: 1,
  phrase: 0,
  routes: [],
  filter: null,
};

const saw = [-1, -0.5, 0, 0.5];
const sine = [0, 1, 0, -1];

describe('wavetable engine', () => {
  afterEach(() => jest.restoreAllMocks());

  it('loads the module, connects the store and the worker by a channel: ready', async () => {
    const { addModule, statuses, worker, engine } = setup();
    expect(statuses).toEqual(['loading']);
    expect(workletLoads(addModule, 'wavetable-osc')).toBe(1);
    expect(
      engine.createVoice(
        { osc: [], start: 0, envelopes: [], envStart: 0, phrase: 0, routes: [], filter: null },
        {}
      )
    ).toBeNull();
    await flush();
    expect(statuses).toEqual(['loading', 'ready']);
    expect(worker()?.url).toMatch(/assets\/worklets\/wavetable-worker\.js$/);
    const [toWorker, transfer] = worker()?.postMessage.mock.calls[0] ?? [];
    expect(toWorker).toEqual({ port: expect.any(Object) });
    expect(transfer).toEqual([toWorker.port]);
  });

  it('creates the store node and passes it the other port', async () => {
    const audioCtx = new AudioContext();
    const created: NodeStub[] = [];
    const Original = globalThis.AudioWorkletNode;
    Object.assign(globalThis, {
      AudioWorkletNode: class extends (Original as unknown as new (...args: unknown[]) => NodeStub) {
        constructor(...args: unknown[]) {
          super(...args);
          created.push(this as unknown as NodeStub);
        }
      },
    });
    const output = audioCtx.createGain();
    createWavetableEngine(audioCtx, output, { createChannel });
    await flush();
    const [store, voices] = created;
    expect(store.name).toBe(STORE_PROCESSOR);
    expect(store.options).toEqual({ numberOfInputs: 0, numberOfOutputs: 1 });
    // every voice in one node, into the output
    expect(voices.name).toBe(VOICES_PROCESSOR);
    expect(voices.options).toEqual({ numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    expect(voices.connect).toHaveBeenCalledWith(output);
    expect(created).toHaveLength(2);
    const [toStore, transfer] = store.port.postMessage.mock.calls[0];
    expect(transfer).toEqual([toStore.port]);
    expect(toStore.port).not.toBe(WorkerStub.created.at(-1)?.postMessage.mock.calls[0][0].port);
  });

  it('sends the latest frames of a table set before it was ready, copied and transferred', async () => {
    const { engine, builds, worker } = setup();
    engine.setTable('osc1', [saw]);
    engine.setTable('osc1', [saw, sine]);
    await flush();
    expect(builds()).toEqual([
      { table: 'osc1', version: 2, frames: [Float32Array.from(saw), Float32Array.from(sine)], morph: false },
    ]);
    const [message, transfer] = worker()?.postMessage.mock.calls[1] ?? [];
    expect(transfer).toEqual(message.frames.map(({ buffer }: Float32Array) => buffer));
  });

  it('numbers the versions of each table', async () => {
    const { engine, builds } = setup();
    await flush();
    engine.setTable('osc1', [saw]);
    engine.setTable('osc2', [sine]);
    engine.setTable('osc1', [sine]);
    expect(builds().map(({ table, version }) => [table, version])).toEqual([
      ['osc1', 1],
      ['osc2', 1],
      ['osc1', 2],
    ]);
  });

  it('removes a table through the worker', async () => {
    const { engine, worker } = setup();
    await flush();
    engine.setTable('osc1', [saw]);
    engine.removeTable('osc1');
    expect(worker()?.postMessage).toHaveBeenLastCalledWith({ table: 'osc1', version: 2, remove: true });
  });

  it('makes a voice once ready: its note on and the automation of its params as events, in f32', async () => {
    const { engine, voices, events } = setup();
    await flush();
    const voice = engine.createVoice(NOTE, { frequency: 220.1, gain1: 0.5 });
    expect(voice?.id).toBe(1);
    voice?.params.gate.cancelScheduledValues(1.5);
    voice?.params.gate.setValueAtTime(2.1, 1.5);
    voice?.params.gain1.setTargetAtTime(0.3, 1.5, 0.0033);
    voice?.params.frequency.exponentialRampToValueAtTime(440, 2);
    const other = engine.createVoice(NOTE, {});
    engine.setRoutes([1, 2], [{ source: 1, param: 'gain1', amount: 0.5, min: 0, max: 1 }]);
    engine.setFilter([2], null);
    // a microtask sends the events of the task, in one message
    expect(events()).toEqual([]);
    await Promise.resolve();
    expect(voices()?.port.postMessage).toHaveBeenCalledTimes(1);
    expect(events()).toEqual([
      { kind: 'on', voice: 1, options: NOTE, params: { frequency: Math.fround(220.1), gain1: 0.5 } },
      { kind: 'cancel', voice: 1, param: 'gate', time: 1.5 },
      { kind: 'set', voice: 1, param: 'gate', value: Math.fround(2.1), time: 1.5 },
      { kind: 'target', voice: 1, param: 'gain1', value: Math.fround(0.3), time: 1.5, constant: 0.0033 },
      { kind: 'ramp', voice: 1, param: 'frequency', value: 440, time: 2 },
      { kind: 'on', voice: 2, options: NOTE, params: {} },
      {
        kind: 'routes',
        voices: [1, 2],
        routes: [{ source: 1, param: 'gain1', amount: 0.5, min: 0, max: 1 }],
      },
      { kind: 'filter', voices: [2], filter: null },
    ]);
    expect(other?.id).toBe(2);
  });

  it('tells a voice its late start and its end from the reports of the node; an ended voice is sent nothing', async () => {
    const { engine, voices, events } = setup();
    await flush();
    const voice = engine.createVoice(NOTE, {});
    const [onStarted, onEnded] = [jest.fn(), jest.fn()];
    Object.assign(voice ?? {}, { onStarted, onEnded });
    voices()?.port.onmessage?.({ data: { started: [[1, 140, 128]], ended: [1] } } as MessageEvent);
    expect(onStarted).toHaveBeenCalledWith(140, 128);
    expect(onStarted.mock.invocationCallOrder[0]).toBeLessThan(onEnded.mock.invocationCallOrder[0]);
    // once
    voices()?.port.onmessage?.({ data: { ended: [1] } } as MessageEvent);
    expect(onEnded).toHaveBeenCalledTimes(1);
    voice?.params.gate.setValueAtTime(2, 1);
    await Promise.resolve();
    expect(events().map(({ kind }) => kind)).toEqual(['on']);
  });

  it('without AudioWorklet or Worker: unsupported, no voices', async () => {
    withoutAudioWorklet();
    const { statuses, engine } = setup();
    await flush();
    expect(statuses).toEqual(['unsupported']);
    expect(
      engine.createVoice(
        { osc: [], start: 0, envelopes: [], envStart: 0, phrase: 0, routes: [], filter: null },
        {}
      )
    ).toBeNull();

    Object.assign(globalThis, { Worker: undefined });
    const second = setup();
    expect(second.statuses).toEqual(['unsupported']);
  });

  it('without MessageChannel (and none passed): unsupported', () => {
    const audioCtx = new AudioContext();
    const engine = createWavetableEngine(audioCtx, audioCtx.createGain());
    expect(engine.$status.value).toBe('unsupported');
  });

  it('a module that fails to load: failed; retry loads it again and sends the tables', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { engine, statuses, addModule, builds } = setup({ failFirstLoad: true });
    engine.setTable('osc1', [saw]);
    await flush();
    expect(statuses).toEqual(['loading', 'failed']);
    expect(error).toHaveBeenCalledWith('The wavetable oscillator failed', expect.any(Error));
    expect(
      engine.createVoice(
        { osc: [], start: 0, envelopes: [], envStart: 0, phrase: 0, routes: [], filter: null },
        {}
      )
    ).toBeNull();

    engine.retry();
    expect(workletLoads(addModule, 'wavetable-osc')).toBe(2);
    await flush();
    expect(statuses).toEqual(['loading', 'failed', 'loading', 'ready']);
    expect(builds()).toEqual([expect.objectContaining({ table: 'osc1', version: 1 })]);
  });

  it('fails when the worker or the store fails, the worker is terminated', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { audioCtx, engine, statuses, worker } = setup();
    await flush();
    const first = worker();
    first?.onerror?.(new Event('error'));
    expect(statuses.at(-1)).toBe('failed');
    expect(first?.terminate).toHaveBeenCalled();

    engine.retry();
    await flush();
    expect(statuses.at(-1)).toBe('ready');
    const store = (
      registrar.getAudioNodes(audioCtx as never, 'AudioWorkletNode' as never) as unknown as NodeStub[]
    )
      .filter(({ name }) => name === STORE_PROCESSOR)
      .at(-1);
    store?.onprocessorerror?.(new Event('processorerror'));
    expect(statuses.at(-1)).toBe('failed');
    expect(worker()?.terminate).toHaveBeenCalled();
  });

  it('stays ready when a version fails to build: only its table keeps the one before', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { engine, statuses, worker } = setup();
    engine.setTable('osc1', [saw]);
    engine.setTable('osc2', [sine]);
    await flush();
    worker()?.onmessage?.({ data: { failed: 'osc1', version: 1, reason: 'RangeError' } } as MessageEvent);
    expect(error).toHaveBeenCalled();
    expect(statuses).toEqual(['loading', 'ready']);
    expect(worker()?.terminate).not.toHaveBeenCalled();
    expect(
      engine.createVoice(
        { osc: [], start: 0, envelopes: [], envStart: 0, phrase: 0, routes: [], filter: null },
        {}
      )
    ).not.toBeNull();
  });

  it('stays ready when a voice fails: the node tells it ended, the synth takes only that voice off', async () => {
    const { engine, statuses, worker, voices } = setup();
    await flush();
    const voice = engine.createVoice(
      { osc: [], start: 0, envelopes: [], envStart: 0, phrase: 0, routes: [], filter: null },
      {}
    );
    const onEnded = jest.fn();
    Object.assign(voice ?? {}, { onEnded });
    voices()?.port.onmessage?.({ data: { ended: [voice?.id] } } as MessageEvent);
    expect(onEnded).toHaveBeenCalled();
    expect(statuses).toEqual(['loading', 'ready']);
    expect(worker()?.terminate).not.toHaveBeenCalled();
    expect(
      engine.createVoice(
        { osc: [], start: 0, envelopes: [], envStart: 0, phrase: 0, routes: [], filter: null },
        {}
      )
    ).not.toBeNull();
  });

  it('fails when the voices node fails: it stops, every voice ends; retry makes it again', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { engine, statuses, voices, events } = setup();
    await flush();
    const node = voices();
    const voice = engine.createVoice(NOTE, {});
    const onEnded = jest.fn();
    Object.assign(voice ?? {}, { onEnded });
    node?.onprocessorerror?.(new Event('processorerror'));
    expect(statuses.at(-1)).toBe('failed');
    expect(onEnded).toHaveBeenCalled();
    expect(node?.port.postMessage).toHaveBeenCalledWith({ stop: true });
    expect(node?.disconnect).toHaveBeenCalled();
    // (the events of the task are dropped with it)
    await Promise.resolve();
    expect(events(node)).toEqual([]);

    engine.retry();
    await flush();
    expect(statuses.at(-1)).toBe('ready');
    expect(voices()).not.toBe(node);
    expect(engine.createVoice(NOTE, {})?.id).toBe(2);
  });

  it('sends the pitch bend to the voices node, one event for every voice; a node made again takes it', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { engine, voices, events } = setup();
    await flush();
    const node = voices();
    engine.setBend(-350);
    await Promise.resolve();
    expect(events(node)).toEqual([{ kind: 'bend', cents: -350 }]);

    node?.onprocessorerror?.(new Event('processorerror'));
    engine.retry();
    await flush();
    expect(voices()).not.toBe(node);
    expect(events()).toEqual([{ kind: 'bend', cents: -350, instantly: true }]);
  });

  it('a node made at rest takes no bend', async () => {
    const { voices, events } = setup();
    await flush();
    await Promise.resolve();
    expect(events(voices())).toEqual([]);
  });

  it('sends the LFOs once it is ready, the last state first at once with every table, then while a voice reads one; a node made again takes them', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { engine, voices, events } = setup();
    const wire = (change: Partial<LfoWire> = {}): LfoWire => ({
      mode: RETRIG,
      delay: 0,
      rise: 0,
      smooth: 0,
      phase: 0,
      anchor: { time: 0, phase: 0, period: 0.5 },
      ...change,
    });
    const [sine, square] = [lfoTable('sine'), lfoTable('square')];
    // before it is ready: kept, the tables of the states before taken on
    engine.setLfos({ at: 0.01, lfos: [wire({ table: sine }), wire({ table: sine }), wire(), wire()] });
    engine.setLfos({ at: 0.02, lfos: [wire({ delay: 1 }), wire({ table: square }), wire(), wire()] });
    await flush();
    const node = voices();
    expect(events(node)).toEqual([
      {
        kind: 'lfos',
        at: 0,
        instantly: true,
        lfos: [wire({ delay: 1, table: sine }), wire({ table: square }), wire(), wire()],
      },
    ]);
    // ready, no voice reads an LFO: kept
    engine.setLfos({ at: 1.5, lfos: [wire({ phase: 0.5 }), wire(), wire(), wire()] });
    await Promise.resolve();
    expect(events(node)).toHaveLength(1);
    // a voice with a route of an LFO: the LFOs as they are before it, then every state as it comes
    const lfoRoute = { source: 4, param: 'gain1', amount: 0.5, min: 0, max: 1 };
    const voice = engine.createVoice({ ...NOTE, routes: [lfoRoute] }, {});
    engine.setLfos({ at: 2, lfos: [wire({ phase: 0.25 }), wire(), wire(), wire()] });
    await Promise.resolve();
    expect(events(node).slice(1)).toEqual([
      {
        kind: 'lfos',
        at: 0,
        instantly: true,
        lfos: [wire({ phase: 0.5, table: sine }), wire({ table: square }), wire(), wire()],
      },
      expect.objectContaining({ kind: 'on', voice: voice?.id }),
      { kind: 'lfos', at: 2, lfos: [wire({ phase: 0.25 }), wire(), wire(), wire()] },
    ]);
    // its routes read none: kept; a route of an LFO again: the LFOs as they are first; ended: kept
    engine.setRoutes([voice?.id ?? 0], []);
    engine.setLfos({ at: 3, lfos: [wire({ phase: 0.75 }), wire(), wire(), wire()] });
    engine.setRoutes([voice?.id ?? 0], [lfoRoute]);
    node?.port.onmessage?.({ data: { ended: [voice?.id] } } as MessageEvent);
    engine.setLfos({ at: 4, lfos: [wire({ phase: 0.1 }), wire(), wire(), wire()] });
    await Promise.resolve();
    expect(events(node).slice(4)).toEqual([
      { kind: 'routes', voices: [voice?.id], routes: [] },
      {
        kind: 'lfos',
        at: 0,
        instantly: true,
        lfos: [wire({ phase: 0.75, table: sine }), wire({ table: square }), wire(), wire()],
      },
      { kind: 'routes', voices: [voice?.id], routes: [lfoRoute] },
    ]);

    node?.onprocessorerror?.(new Event('processorerror'));
    engine.retry();
    await flush();
    expect(voices()).not.toBe(node);
    expect(events()).toEqual([
      {
        kind: 'lfos',
        at: 0,
        instantly: true,
        lfos: [wire({ phase: 0.1, table: sine }), wire({ table: square }), wire(), wire()],
      },
    ]);
  });

  it('retry does nothing unless it failed', async () => {
    const { engine, addModule } = setup();
    engine.retry();
    await flush();
    engine.retry();
    expect(workletLoads(addModule, 'wavetable-osc')).toBe(1);
  });

  it('destroy terminates the worker, stops the voices node and completes the status', async () => {
    const { engine, worker, voices } = setup();
    await flush();
    const complete = jest.fn();
    engine.$status.subscribe({ complete });
    const voice = engine.createVoice(NOTE, {});
    const onEnded = jest.fn();
    Object.assign(voice ?? {}, { onEnded });
    const node = voices();
    engine.destroy();
    expect(worker()?.terminate).toHaveBeenCalled();
    expect(node?.port.postMessage).toHaveBeenCalledWith({ stop: true });
    expect(node?.disconnect).toHaveBeenCalled();
    // (the synth is gone too: no voice is told ended)
    expect(onEnded).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalled();
  });

  describe('the state of each table', () => {
    it('sending, then stored or refused by the store; an answer for a version before the latest is late', async () => {
      const { engine, ack, fromStore } = setup();
      engine.setTable('osc1', [saw]);
      engine.setTable('osc2', [sine]);
      // (sent once ready)
      expect(engine.$tables.value).toEqual({});
      await flush();
      expect(engine.$tables.value).toEqual({ osc1: 'sending', osc2: 'sending' });
      ack('osc1', 1);
      fromStore({ refused: 'osc2', version: 1 });
      expect(engine.$tables.value).toEqual({ osc1: 'stored', osc2: 'refused' });
      engine.setTable('osc1', [sine]);
      ack('osc1', 1);
      expect(engine.$tables.value['osc1']).toBe('sending');
    });

    it('a version that failed to build: failed; removed, a table has no state', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const { engine, worker } = setup();
      engine.setTable('osc1', [saw]);
      await flush();
      worker()?.onmessage?.({ data: { failed: 'osc1', version: 1, reason: 'RangeError' } } as MessageEvent);
      expect(engine.$tables.value).toEqual({ osc1: 'failed' });
      engine.removeTable('osc1');
      expect(engine.$tables.value).toEqual({});
    });

    it('retryTable sends a refused or failed version again, nothing else', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const { engine, builds, fromStore, worker } = setup();
      engine.setTable('osc1', [saw]);
      engine.setTable('osc2', [sine]);
      await flush();
      engine.retryTable('osc1');
      expect(builds()).toHaveLength(2);
      fromStore({ refused: 'osc1', version: 1 });
      worker()?.onmessage?.({ data: { failed: 'osc2', version: 1, reason: 'RangeError' } } as MessageEvent);
      engine.retryTable('osc1');
      engine.retryTable('osc2');
      expect(builds().slice(2)).toEqual([
        expect.objectContaining({ table: 'osc1', version: 1 }),
        expect.objectContaining({ table: 'osc2', version: 1 }),
      ]);
      expect(engine.$tables.value).toEqual({ osc1: 'sending', osc2: 'sending' });
    });

    it('memory freed by the store sends a refused version again once; refused again, it waits for Retry', async () => {
      const { engine, builds, fromStore, ack } = setup();
      engine.setTable('osc1', [saw]);
      engine.setTable('osc2', [sine]);
      await flush();
      ack('osc2', 1);
      fromStore({ refused: 'osc1', version: 1 });
      fromStore({ freedBytes: 1024 });
      expect(builds()).toHaveLength(3);
      expect(builds()[2]).toMatchObject({ table: 'osc1', version: 1 });
      fromStore({ refused: 'osc1', version: 1 });
      fromStore({ freedBytes: 1024 });
      expect(builds()).toHaveLength(3);
      expect(engine.$tables.value['osc1']).toBe('refused');
      // Retry, or a new version, may go once more
      engine.retryTable('osc1');
      fromStore({ refused: 'osc1', version: 1 });
      fromStore({ freedBytes: 1024 });
      expect(builds()).toHaveLength(5);
      ack('osc1', 1);
      expect(engine.$tables.value).toEqual({ osc1: 'stored', osc2: 'stored' });
    });
  });

  describe('pending tables', () => {
    it('lists the tables until the store acknowledges their latest version', async () => {
      const { engine, ack } = setup();
      engine.setTable('osc1', [saw]);
      engine.setTable('osc2', [sine]);
      await flush();
      expect(engine.pending()).toEqual(['osc1', 'osc2']);
      ack('osc1', 1);
      expect(engine.pending()).toEqual(['osc2']);
      engine.setTable('osc1', [sine]);
      // an ack of an older version doesn't count
      ack('osc1', 1);
      expect(engine.pending()).toEqual(['osc1', 'osc2']);
      ack('osc1', 2);
      ack('osc2', 1);
      expect(engine.pending()).toEqual([]);
    });

    it('numbers a table set again after its removal on from it: the store takes it over the version it holds', async () => {
      const { engine, ack, builds, worker } = setup();
      await flush();
      engine.setTable('osc1', [saw]);
      engine.setTable('osc1', [sine]);
      engine.removeTable('osc1');
      expect(worker()?.postMessage).toHaveBeenLastCalledWith({ table: 'osc1', version: 3, remove: true });
      engine.setTable('osc1', [saw]);
      expect(builds().at(-1)).toMatchObject({ table: 'osc1', version: 4 });
      // the ack of the removal doesn't count, the one of version 4 does
      ack('osc1', 3);
      expect(engine.pending()).toEqual(['osc1']);
      ack('osc1', 4);
      expect(engine.pending()).toEqual([]);
    });

    it('forgets a removed table, and its ack', async () => {
      const { engine, ack } = setup();
      engine.setTable('osc1', [saw]);
      await flush();
      engine.removeTable('osc1');
      ack('osc1', 2);
      expect(engine.pending()).toEqual([]);
      engine.setTable('osc1', [sine]);
      expect(engine.pending()).toEqual(['osc1']);
    });

    it('sends the tables again after a failure: pending until acknowledged again', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const { engine, ack, worker, store, fromStore } = setup();
      engine.setTable('osc1', [saw]);
      await flush();
      ack('osc1', 1);
      const failed = store();
      worker()?.onerror?.(new Event('error'));
      engine.retry();
      await flush();
      expect(engine.pending()).toEqual(['osc1']);
      // the failed store is not heard anymore
      fromStore({ stored: 'osc1', version: 1 }, failed);
      expect(engine.pending()).toEqual(['osc1']);
      ack('osc1', 1);
      expect(engine.pending()).toEqual([]);
    });
  });

  describe('stats', () => {
    const worklet = { tables: 1, versions: 1, bytes: 1024, voices: 2, frame: 128 };
    const builder = { pending: 0, pooled: 1, pool: 1024, builds: 1, lastMs: 3, totalMs: 3, maxMs: 3 };

    it('null unless ready', async () => {
      const { engine } = setup();
      expect(await engine.stats()).toBeNull();
      // (its module would load without AudioWorkletNode)
      engine.destroy();
      withoutAudioWorklet();
      expect(await setup().engine.stats()).toBeNull();
    });

    it('asks the store and the worker for their counters', async () => {
      const { engine, store, worker, answer } = setup();
      await flush();
      const asked = engine.stats();
      expect(store()?.port.postMessage).toHaveBeenLastCalledWith({ stats: true });
      expect(worker()?.postMessage).toHaveBeenLastCalledWith({ stats: true });
      answer(worklet, builder);
      expect(await asked).toEqual({ worklet, worker: builder });
    });

    it("null when an answer doesn't come in time; a late one doesn't answer the next request", async () => {
      const { engine, answer } = setup();
      await flush();
      expect(await engine.stats(5)).toBeNull();
      const next = engine.stats();
      answer({ ...worklet, frame: 1 }, builder);
      answer({ ...worklet, frame: 2 }, builder);
      expect((await next)?.worklet.frame).toBe(2);
    });

    it('a failure answers null', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const { engine, worker } = setup();
      await flush();
      const asked = engine.stats();
      worker()?.onerror?.(new Event('error'));
      expect(await asked).toBeNull();
    });
  });

  it('a module that loads after destroy creates nothing', async () => {
    const { engine } = setup();
    const workers = WorkerStub.created.length;
    engine.destroy();
    await flush();
    expect(WorkerStub.created).toHaveLength(workers);
  });
});
