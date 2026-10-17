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
  return { audioCtx, addModule, engine, statuses, worker, builds };
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

  it('fails when the worker or a processor fails, the worker is terminated', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { engine, statuses, worker } = setup();
    await flush();
    const first = worker();
    first?.onerror?.(new Event('error'));
    expect(statuses.at(-1)).toBe('failed');
    expect(first?.terminate).toHaveBeenCalled();

    engine.retry();
    await flush();
    expect(statuses.at(-1)).toBe('ready');
    const voice = engine.createVoice({ osc: [], start: 0 }, {});
    voice?.onprocessorerror?.(new Event('processorerror'));
    expect(statuses.at(-1)).toBe('failed');
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

  it('a module that loads after destroy creates nothing', async () => {
    const { engine } = setup();
    const workers = WorkerStub.created.length;
    engine.destroy();
    await flush();
    expect(WorkerStub.created).toHaveLength(workers);
  });
});
