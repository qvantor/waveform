import { registrar } from 'standardized-audio-context-mock';
import { withoutAudioWorklet } from '../../../../test-utils/no-audio-worklet';
import { workletLoads } from '../../../../test-utils/worklet-loads';
import { MessageChannelStub, WorkerStub } from '../../../../test-utils/worker-stub';
import { createWavetableEngine, WavetableStatus } from './wavetable-engine';
import { STORE_PROCESSOR, VOICE_PROCESSOR } from './wavetable-osc-params';

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
  const engine = createWavetableEngine(audioCtx, { createChannel });
  const statuses: WavetableStatus[] = [];
  engine.$status.subscribe((status) => statuses.push(status));
  const worker = () => WorkerStub.created.at(-1);
  // the frames of the build messages posted to the worker
  const builds = () =>
    (worker()?.postMessage.mock.calls ?? [])
      .map(([message]) => message)
      .filter((message) => 'frames' in message);
  // the store node and what it posts to the main thread: an ack of a version, its counters
  const store = () =>
    (registrar.getAudioNodes(audioCtx as never, 'AudioWorkletNode' as never) as unknown as NodeStub[])
      .filter(({ name }) => name === STORE_PROCESSOR)
      .at(-1);
  const fromStore = (data: unknown, node = store()) => node?.port.onmessage?.({ data } as MessageEvent);
  const ack = (table: string, version: number) => fromStore({ stored: table, version });
  // both answers to a stats request
  const answer = (worklet: unknown, builder: unknown) => {
    fromStore({ stats: worklet });
    worker()?.onmessage?.({ data: { stats: builder } } as MessageEvent);
  };
  return { audioCtx, addModule, engine, statuses, worker, builds, store, fromStore, ack, answer };
};

const saw = [-1, -0.5, 0, 0.5];
const sine = [0, 1, 0, -1];

describe('wavetable engine', () => {
  afterEach(() => jest.restoreAllMocks());

  it('loads the module, connects the store and the worker by a channel: ready', async () => {
    const { addModule, statuses, worker, engine } = setup();
    expect(statuses).toEqual(['loading']);
    expect(workletLoads(addModule, 'wavetable-osc')).toBe(1);
    expect(engine.createVoice({ osc: [], start: 0 }, {})).toBeNull();
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
    createWavetableEngine(audioCtx, { createChannel });
    await flush();
    const [store] = created;
    expect(store.name).toBe(STORE_PROCESSOR);
    expect(store.options).toEqual({ numberOfInputs: 0, numberOfOutputs: 1 });
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
      { table: 'osc1', version: 2, frames: [Float32Array.from(saw), Float32Array.from(sine)] },
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

  it('creates the node of a voice once ready', async () => {
    const { engine } = setup();
    await flush();
    const options = { osc: [{ table: 'osc1', unison: 2, phase: 0, phaseRand: 0 }, null], start: 1 };
    const node = engine.createVoice(options, { frequency: 220, gain1: 0.5 }) as NodeStub;
    expect(node.name).toBe(VOICE_PROCESSOR);
    expect(node.options).toEqual({
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: options,
      parameterData: { frequency: 220, gain1: 0.5 },
    });
    expect(node.parameters.get('frequency')?.value).toBe(220);
    expect(node.parameters.get('gain2')?.value).toBe(0.5);
  });

  it('without AudioWorklet or Worker: unsupported, no voices', async () => {
    withoutAudioWorklet();
    const { statuses, engine } = setup();
    await flush();
    expect(statuses).toEqual(['unsupported']);
    expect(engine.createVoice({ osc: [], start: 0 }, {})).toBeNull();

    Object.assign(globalThis, { Worker: undefined });
    const second = setup();
    expect(second.statuses).toEqual(['unsupported']);
  });

  it('without MessageChannel (and none passed): unsupported', () => {
    const engine = createWavetableEngine(new AudioContext());
    expect(engine.$status.value).toBe('unsupported');
  });

  it('a module that fails to load: failed; retry loads it again and sends the tables', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { engine, statuses, addModule, builds } = setup({ failFirstLoad: true });
    engine.setTable('osc1', [saw]);
    await flush();
    expect(statuses).toEqual(['loading', 'failed']);
    expect(error).toHaveBeenCalledWith('The wavetable oscillator failed', expect.any(Error));
    expect(engine.createVoice({ osc: [], start: 0 }, {})).toBeNull();

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

  it('stays ready when a voice fails: the synth takes only that voice off', async () => {
    const { engine, statuses, worker } = setup();
    await flush();
    const voice = engine.createVoice({ osc: [], start: 0 }, {});
    expect(voice?.onprocessorerror).toBeNull();
    expect(statuses).toEqual(['loading', 'ready']);
    expect(worker()?.terminate).not.toHaveBeenCalled();
    expect(engine.createVoice({ osc: [], start: 0 }, {})).not.toBeNull();
  });

  it('retry does nothing unless it failed', async () => {
    const { engine, addModule } = setup();
    engine.retry();
    await flush();
    engine.retry();
    expect(workletLoads(addModule, 'wavetable-osc')).toBe(1);
  });

  it('destroy terminates the worker and completes the status', async () => {
    const { engine, worker } = setup();
    await flush();
    const complete = jest.fn();
    engine.$status.subscribe({ complete });
    engine.destroy();
    expect(worker()?.terminate).toHaveBeenCalled();
    expect(complete).toHaveBeenCalled();
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
