import { BehaviorSubject } from 'rxjs';
import { isWorkletSupported, loadWorklet, WORKLETS_PATH } from '../../fx/effects/load-worklet';
import type {
  BuilderPortMessage,
  BuilderStats,
  BuilderStatsMessage,
  BuildMessage,
} from './wavetable-builder';
import type {
  StatsRequest,
  StoreStatsMessage,
  StoreStoredMessage,
  StoreTableMessage,
  VoiceOptions,
} from './voice-options';
import { STORE_PROCESSOR, VOICE_PROCESSOR, VoiceParam } from './wavetable-osc-params';

// the worklet module (wavetable-osc.worklet.ts) and the worker (wavetable.worker.ts), bundled by `npm run
// worklets` into assets/worklets/
export const WAVETABLE_WORKLET = 'wavetable-osc';
export const WAVETABLE_WORKER = 'wavetable-worker';

// loading: the module is being added; unsupported: no AudioWorklet (http on a LAN IP, old Safari) or no
// Worker; failed: the module, the worker or the store failed, retry() loads it again (a voice that fails
// only ends: the synth takes it off). Without it the synth doesn't play: there is no native fallback
export type WavetableStatus = 'loading' | 'ready' | 'unsupported' | 'failed';

// a voice node: no input, both oscillators into one stereo output
const VOICE_NODE_OPTIONS: AudioWorkletNodeOptions = {
  numberOfInputs: 0,
  numberOfOutputs: 1,
  outputChannelCount: [2],
};

// the worker and the channel to the store (jsdom has neither: the specs pass stubs)
export interface WavetableEngineDependencies {
  createWorker?: (url: string) => Worker;
  createChannel?: () => MessageChannel;
}

const defaultChannel = () => new MessageChannel();

// the counters of the store, the voices and the worker (the perf test hook)
export interface WavetableEngineStats {
  worklet: StoreStatsMessage['stats'];
  worker: BuilderStats;
}
type Waiter<T> = (answer: T | null) => void;

// the wavetable oscillator of an AudioContext, one for both oscillators: loads the worklet module (the synth
// core does it at its start, like the limiter), creates the store node (it receives the tables, the voice
// processors of the context read them) and the worker that builds the levels of the tables, connected to the
// store by a MessageChannel: the levels go from the worker to the audio thread, transferred, never through
// the main thread. setTable() sends a new version of a table (the latest frames are kept: they are sent once
// it is ready, and again after a retry); createVoice() creates the node of a note, null until it is ready
// (a note played meanwhile is not played later)
export const createWavetableEngine = (
  audioCtx: BaseAudioContext,
  {
    createWorker = (url) => new Worker(url),
    createChannel = typeof MessageChannel === 'undefined' ? undefined : defaultChannel,
  }: WavetableEngineDependencies = {}
) => {
  const $status = new BehaviorSubject<WavetableStatus>('loading');
  const tables = new Map<string, { version: number; frames: ArrayLike<number>[]; morph: boolean }>();
  // the last version of each table, kept after a removal: versions only grow, so a table set again after it was
  // removed is newer than the version the store may still hold (the worker replaces a waiting removal with it)
  const versions = new Map<string, number>();
  const nextVersion = (table: string) => {
    const version = (versions.get(table) ?? 0) + 1;
    versions.set(table, version);
    return version;
  };
  let store: AudioWorkletNode | null = null;
  let worker: Worker | null = null;
  let destroyed = false;
  // the version of each table the store has acknowledged (when it is the latest, new voices play it)
  const stored = new Map<string, number>();
  // the answers to stats requests, in the order they were asked (each port answers in order)
  const storeWaiters: Waiter<StoreStatsMessage['stats']>[] = [];
  const workerWaiters: Waiter<BuilderStats>[] = [];

  const teardown = () => {
    worker?.terminate();
    worker = null;
    store?.disconnect();
    store = null;
    stored.clear();
    storeWaiters.splice(0).forEach((answer) => answer(null));
    workerWaiters.splice(0).forEach((answer) => answer(null));
  };

  const fail = (error: unknown) => {
    if (destroyed || $status.value === 'failed') return;
    console.error('The wavetable oscillator failed', error);
    teardown();
    $status.next('failed');
  };

  // the frames are copied into arrays of their own, transferred to the worker
  const send = (table: string) => {
    const entry = tables.get(table);
    if (!worker || !entry) return;
    const frames = entry.frames.map((frame) => Float32Array.from(frame));
    const message: BuildMessage = { table, version: entry.version, frames, morph: entry.morph };
    worker.postMessage(
      message,
      frames.map(({ buffer }) => buffer)
    );
  };

  const load = () => {
    if (!isWorkletSupported(audioCtx, WAVETABLE_WORKLET) || typeof Worker === 'undefined' || !createChannel) {
      $status.next('unsupported');
      return;
    }
    $status.next('loading');
    loadWorklet(audioCtx, WAVETABLE_WORKLET)
      .then(() => {
        if (destroyed) return;
        const node = new AudioWorkletNode(audioCtx, STORE_PROCESSOR, {
          numberOfInputs: 0,
          numberOfOutputs: 1,
        });
        node.onprocessorerror = (event) => {
          if (store === node) fail(event);
        };
        // the acks and the counters of the store, the counters of the worker (the perf build)
        if (__PERF__)
          node.port.onmessage = ({ data }: MessageEvent<StoreStoredMessage | StoreStatsMessage>) => {
            if (store !== node) return;
            if ('stats' in data) storeWaiters.shift()?.(data.stats);
            else if (tables.get(data.stored)?.version === data.version) stored.set(data.stored, data.version);
          };
        const created = createWorker(
          new URL(`${WORKLETS_PATH}${WAVETABLE_WORKER}.js`, document.baseURI).href
        );
        created.onerror = (event) => {
          if (worker === created) fail(event);
        };
        if (__PERF__)
          created.onmessage = ({ data }: MessageEvent<BuilderStatsMessage>) => {
            if (worker === created && data.stats) workerWaiters.shift()?.(data.stats);
          };
        const { port1, port2 } = (createChannel as () => MessageChannel)();
        const toStore: BuilderPortMessage = { port: port1 };
        const toWorker: BuilderPortMessage = { port: port2 };
        node.port.postMessage(toStore, [port1]);
        created.postMessage(toWorker, [port2]);
        store = node;
        worker = created;
        $status.next('ready');
        tables.forEach((_, table) => send(table));
      })
      .catch(fail);
  };
  load();

  return {
    $status,
    // a new version of the table (the frames of the model, read when it is sent; with a morph the worker
    // expands them to 256: wavetable-frames.ts)
    setTable: (table: string, frames: ArrayLike<number>[], morph = false) => {
      tables.set(table, { version: nextVersion(table), frames, morph });
      send(table);
    },
    // the table is gone (its oscillator was destroyed): the store frees it once no voice plays it
    removeTable: (table: string) => {
      const entry = tables.get(table);
      tables.delete(table);
      stored.delete(table);
      if (!entry) return;
      const version = nextVersion(table);
      if (!worker) return;
      const message: StoreTableMessage = { table, version, remove: true };
      worker.postMessage(message);
    },
    // the node of a note; an error of its processor ends only that voice (the synth takes it off), the store,
    // the worker and the other voices play on
    createVoice: (options: VoiceOptions, parameterData: Partial<Record<VoiceParam, number>>) => {
      if ($status.value !== 'ready') return null;
      return new AudioWorkletNode(audioCtx, VOICE_PROCESSOR, {
        ...VOICE_NODE_OPTIONS,
        processorOptions: options,
        parameterData,
      });
    },
    // the tables whose latest version the store hasn't acknowledged yet (a note meanwhile plays the previous
    // version, or a sine for a new table); the perf build only
    pending: () =>
      __PERF__
        ? [...tables].filter(([table, { version }]) => stored.get(table) !== version).map(([table]) => table)
        : [],
    // the counters of the store, the voices and the worker (the perf build); null unless ready or when an
    // answer doesn't come in time (a late answer still takes its own request: the queues stay in order)
    stats: (timeout = 1000): Promise<WavetableEngineStats | null> => {
      if (!__PERF__ || !store || !worker) return Promise.resolve(null);
      const request: StatsRequest = { stats: true };
      const ask = <T>(waiters: Waiter<T>[], post: () => void) =>
        new Promise<T | null>((resolve) => {
          const timer = setTimeout(() => resolve(null), timeout);
          waiters.push((answer) => {
            clearTimeout(timer);
            resolve(answer);
          });
          post();
        });
      const [node, builder] = [store, worker];
      return Promise.all([
        ask(storeWaiters, () => node.port.postMessage(request)),
        ask(workerWaiters, () => builder.postMessage(request)),
      ]).then(([worklet, built]) => (worklet && built ? { worklet, worker: built } : null));
    },
    retry: () => {
      if ($status.value === 'failed') load();
    },
    destroy: () => {
      destroyed = true;
      teardown();
      $status.complete();
    },
  };
};
