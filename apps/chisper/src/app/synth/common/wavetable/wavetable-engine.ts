import { BehaviorSubject } from 'rxjs';
import { isWorkletSupported, loadWorklet, WORKLETS_PATH } from '../../fx/effects/load-worklet';
import type { StopMessage } from '../../fx/effects/stereo-processor';
import { createLfoFeed, LfosState } from '../lfo/lfo-curve';
import { isLfoSource } from '../../fx/effects/fx-modulation';
import type {
  BuilderFailedMessage,
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
  VoiceEvent,
  VoiceEventsMessage,
  VoiceFilterOptions,
  VoiceOptions,
  VoiceRoute,
  VoicesReportMessage,
  VoiceVelocity,
} from './voice-options';
import { STORE_PROCESSOR, VOICE_PARAMETERS, VOICES_PROCESSOR, VoiceParam } from './wavetable-osc-params';
import type { StoreFreedBytesMessage, StoreRefusedMessage } from './wavetable-osc-wasm';

// the worklet module (wavetable-osc.worklet.ts) and the worker (wavetable.worker.ts), bundled by `npm run
// worklets` into assets/worklets/
export const WAVETABLE_WORKLET = 'wavetable-osc';
export const WAVETABLE_WORKER = 'wavetable-worker';

// loading: the module is being added; unsupported: no AudioWorklet (http on a LAN IP, old Safari) or no
// Worker; failed: the module, the worker or the store failed, retry() loads it again (a voice that fails
// only ends: the synth takes it off). Without it the synth doesn't play: there is no native fallback
export type WavetableStatus = 'loading' | 'ready' | 'unsupported' | 'failed';

// the latest version of a table: on its way to the store (built, sent in chunks), stored (new notes play it),
// refused by the store (no memory for it) or failed to build in the worker; refused and failed: the version
// before it plays on, retryTable() sends it again
export type TableState = 'sending' | 'stored' | 'refused' | 'failed';

// the voices node: no input, every voice into one stereo output
const VOICES_NODE_OPTIONS: AudioWorkletNodeOptions = {
  numberOfInputs: 0,
  numberOfOutputs: 1,
  outputChannelCount: [2],
};

// a param of a voice as the synth automates it: the calls of an AudioParam it makes, each sent to the voices node
// as an event (its value in f32, as an AudioParam keeps it), worked out there by the formulas of the spec
export interface ParamAutomation {
  setValueAtTime: (value: number, time: number) => void;
  setTargetAtTime: (value: number, time: number, constant: number) => void;
  exponentialRampToValueAtTime: (value: number, time: number) => void;
  cancelScheduledValues: (time: number) => void;
}

// a voice of the voices node: its params; the node tells its start (late, of mono or traced: the frames it
// started and was scheduled at, once) and its end (released to 0, stolen, failed, or the node failed)
export interface VoiceHandle {
  readonly id: number;
  readonly params: Record<VoiceParam, ParamAutomation>;
  onStarted: ((started: number, scheduled: number) => void) | null;
  onEnded: (() => void) | null;
}

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
// core does it at its start, like the limiter), creates the store node (it receives the tables), the voices node
// (every note plays in it, into `output`) and the worker that builds the levels of the tables, connected to the
// store by a MessageChannel: the levels go from the worker to the audio thread, transferred, never through
// the main thread. setTable() sends a new version of a table (the latest frames are kept: they are sent once
// it is ready, and again after a retry); createVoice() makes the voice of a note, null until it is ready (a note
// played meanwhile is not played later). What the voices do goes to the node as events, those of a task in one
// message (a microtask sends them), in the order they were made
export const createWavetableEngine = (
  audioCtx: BaseAudioContext,
  output: AudioNode,
  {
    createWorker = (url) => new Worker(url),
    createChannel = typeof MessageChannel === 'undefined' ? undefined : defaultChannel,
  }: WavetableEngineDependencies = {}
) => {
  const $status = new BehaviorSubject<WavetableStatus>('loading');
  const $tables = new BehaviorSubject<Record<string, TableState>>({});
  const tables = new Map<string, { version: number; frames: ArrayLike<number>[]; morph: boolean }>();
  // the tables whose refused version was sent again once the store freed memory (once a version: refused again,
  // it waits for retryTable)
  const retried = new Set<string>();
  // the last version of each table, kept after a removal: versions only grow, so a table set again after it was
  // removed is newer than the version the store may still hold (the worker replaces a waiting removal with it)
  const versions = new Map<string, number>();
  const nextVersion = (table: string) => {
    const version = (versions.get(table) ?? 0) + 1;
    versions.set(table, version);
    return version;
  };
  let store: AudioWorkletNode | null = null;
  let voices: AudioWorkletNode | null = null;
  let worker: Worker | null = null;
  let destroyed = false;
  // the voices playing, by id (unique in the engine: the node of a retry starts empty), and the events of this
  // task
  const handles = new Map<number, VoiceHandle>();
  let lastVoice = 0;
  let events: VoiceEvent[] = [];
  // the pitch bend of the voices (cents): a node made again (Retry) takes it at once
  let bend = 0;
  // the LFOs (every state merged: a node made again takes them at once), sent on only while a voice reads one:
  // the voices whose routes read an LFO
  const lfoVoices = new Set<number>();
  const feed = createLfoFeed((state) => {
    if (voices) enqueue({ kind: 'lfos', ...state });
  });
  const readsLfo = (routes: VoiceRoute[]) => routes.some(({ source }) => isLfoSource(source));
  let sending = false;
  // the version of each table the store has acknowledged (when it is the latest, new voices play it)
  const stored = new Map<string, number>();
  // the answers to stats requests, in the order they were asked (each port answers in order)
  const storeWaiters: Waiter<StoreStatsMessage['stats']>[] = [];
  const workerWaiters: Waiter<BuilderStats>[] = [];

  // the events of this task to the voices node, in one message
  const flush = () => {
    sending = false;
    if (events.length === 0) return;
    const message: VoiceEventsMessage = { events };
    events = [];
    voices?.port.postMessage(message);
  };
  const enqueue = (event: VoiceEvent) => {
    events.push(event);
    if (sending) return;
    sending = true;
    queueMicrotask(flush);
  };

  // the voices node stopped (its voices give their tables back to the store); `end`: every voice is ended (the
  // synth lets their keys go)
  const teardown = (end: boolean) => {
    worker?.terminate();
    worker = null;
    store?.disconnect();
    store = null;
    if (voices) {
      const stop: StopMessage = { stop: true };
      voices.port.postMessage(stop);
      voices.disconnect();
      voices = null;
    }
    events = [];
    const ended = [...handles.values()];
    handles.clear();
    lfoVoices.clear();
    feed.use(false);
    if (end) ended.forEach((handle) => handle.onEnded?.());
    stored.clear();
    storeWaiters.splice(0).forEach((answer) => answer(null));
    workerWaiters.splice(0).forEach((answer) => answer(null));
  };

  const fail = (error: unknown) => {
    if (destroyed || $status.value === 'failed') return;
    console.error('The wavetable oscillator failed', error);
    teardown(true);
    $status.next('failed');
  };

  // the starts and the ends of a block of the voices node
  const report = ({ started, ended }: VoicesReportMessage) => {
    started?.forEach(([id, at, scheduled]) => handles.get(id)?.onStarted?.(at, scheduled));
    ended?.forEach((id) => {
      const handle = handles.get(id);
      handles.delete(id);
      lfoVoices.delete(id);
      handle?.onEnded?.();
    });
    feed.use(lfoVoices.size > 0);
  };

  // the params of voice `id`: their calls as events (none once it has ended)
  const automation = (id: number, param: VoiceParam): ParamAutomation => {
    const automate = (kind: 'set' | 'target' | 'ramp', value: number, time: number, constant?: number) => {
      if (handles.has(id))
        enqueue({
          kind,
          voice: id,
          param,
          value: Math.fround(value),
          time,
          ...(constant !== undefined && { constant }),
        });
    };
    return {
      setValueAtTime: (value, time) => automate('set', value, time),
      setTargetAtTime: (value, time, constant) => automate('target', value, time, constant),
      exponentialRampToValueAtTime: (value, time) => automate('ramp', value, time),
      cancelScheduledValues: (time) => {
        if (handles.has(id)) enqueue({ kind: 'cancel', voice: id, param, time });
      },
    };
  };

  const setState = (table: string, state: TableState | null) => {
    const { [table]: _, ...others } = $tables.value;
    $tables.next(state ? { ...others, [table]: state } : others);
  };
  // an answer for the latest version of a table (one for a version before it is late: not its state)
  const answer = (table: string, version: number, state: TableState) => {
    if (tables.get(table)?.version === version) setState(table, state);
  };

  // the frames are copied into arrays of their own, transferred to the worker
  const send = (table: string) => {
    const entry = tables.get(table);
    if (!worker || !entry) return;
    setState(table, 'sending');
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
        // the answers of the store (its port is started: nothing piles up in it): a version stored or refused, the
        // memory it freed (a refused version is sent again, once), its counters (the perf build)
        node.port.onmessage = ({
          data,
        }: MessageEvent<
          StoreStoredMessage | StoreRefusedMessage | StoreFreedBytesMessage | StoreStatsMessage
        >) => {
          if (store !== node) return;
          if ('stats' in data) storeWaiters.shift()?.(data.stats);
          else if ('freedBytes' in data) retryRefused();
          else if ('refused' in data) answer(data.refused, data.version, 'refused');
          else {
            if (tables.get(data.stored)?.version === data.version) stored.set(data.stored, data.version);
            answer(data.stored, data.version, 'stored');
          }
        };
        const created = createWorker(
          new URL(`${WORKLETS_PATH}${WAVETABLE_WORKER}.js`, document.baseURI).href
        );
        // an error of the worker itself (its script) fails the engine; a version that failed to build only its
        // table: it plays the version before, the engine stays ready
        created.onerror = (event) => {
          if (worker === created) fail(event);
        };
        created.onmessage = ({ data }: MessageEvent<BuilderStatsMessage | BuilderFailedMessage>) => {
          if (worker !== created) return;
          if ('failed' in data) {
            console.error(
              `The version ${data.version} of the table ${data.failed} failed to build`,
              data.reason
            );
            answer(data.failed, data.version, 'failed');
            return;
          }
          // (the counters of the perf build)
          if (__PERF__ && data.stats) workerWaiters.shift()?.(data.stats);
        };
        const { port1, port2 } = (createChannel as () => MessageChannel)();
        const toStore: BuilderPortMessage = { port: port1 };
        const toWorker: BuilderPortMessage = { port: port2 };
        node.port.postMessage(toStore, [port1]);
        created.postMessage(toWorker, [port2]);
        // every voice in one node: an error outside its voices (a voice that traps only ends) fails the engine,
        // its voices end, Retry makes it again
        const voicesNode = new AudioWorkletNode(audioCtx, VOICES_PROCESSOR, VOICES_NODE_OPTIONS);
        voicesNode.onprocessorerror = (event) => {
          if (voices === voicesNode) fail(event);
        };
        voicesNode.port.onmessage = ({ data }: MessageEvent<VoicesReportMessage>) => {
          if (voices === voicesNode) report(data);
        };
        voicesNode.connect(output);
        store = node;
        voices = voicesNode;
        worker = created;
        if (bend !== 0) enqueue({ kind: 'bend', cents: bend, instantly: true });
        const lfos = feed.initial();
        if (lfos) enqueue({ kind: 'lfos', ...lfos });
        $status.next('ready');
        tables.forEach((_, table) => send(table));
      })
      .catch(fail);
  };
  load();

  // the store freed memory: every table whose latest version it refused is sent again, once
  const retryRefused = () =>
    Object.entries($tables.value).forEach(([table, state]) => {
      if (state !== 'refused' || retried.has(table)) return;
      retried.add(table);
      send(table);
    });

  return {
    $status,
    $tables,
    // a new version of the table (the frames of the model, read when it is sent; with a morph the worker
    // expands them to 256: wavetable-frames.ts)
    setTable: (table: string, frames: ArrayLike<number>[], morph = false) => {
      tables.set(table, { version: nextVersion(table), frames, morph });
      retried.delete(table);
      send(table);
    },
    // the latest version of a table the store refused or the worker failed to build, sent again (a refusal after
    // it is sent again once more when the store frees memory)
    retryTable: (table: string) => {
      const state = $tables.value[table];
      if (state !== 'refused' && state !== 'failed') return;
      retried.delete(table);
      send(table);
    },
    // the table is gone (its oscillator was destroyed): the store frees it once no voice plays it
    removeTable: (table: string) => {
      const entry = tables.get(table);
      tables.delete(table);
      stored.delete(table);
      retried.delete(table);
      setState(table, null);
      if (!entry) return;
      const version = nextVersion(table);
      if (!worker) return;
      const message: StoreTableMessage = { table, version, remove: true };
      worker.postMessage(message);
    },
    // the voice of a note, its options and the values of its params at the note on (in f32); a voice that fails
    // ends alone (the synth takes it off), the store, the worker and the other voices play on
    createVoice: (options: VoiceOptions, values: Partial<Record<VoiceParam, number>>): VoiceHandle | null => {
      if ($status.value !== 'ready') return null;
      const id = ++lastVoice;
      const params = Object.fromEntries(
        VOICE_PARAMETERS.map(({ name }) => [name, automation(id, name as VoiceParam)])
      ) as Record<VoiceParam, ParamAutomation>;
      const handle: VoiceHandle = { id, params, onStarted: null, onEnded: null };
      handles.set(id, handle);
      const initial = Object.fromEntries(
        Object.entries(values).map(([name, value]) => [name, Math.fround(value)])
      ) as Partial<Record<VoiceParam, number>>;
      // (the LFOs before the voice that reads them)
      if (readsLfo(options.routes)) lfoVoices.add(id);
      feed.use(lfoVoices.size > 0);
      enqueue({ kind: 'on', voice: id, options, params: initial });
      return handle;
    },
    // the routes, the filter, the velocity of playing voices changed (one event for them all)
    setRoutes: (ids: number[], routes: VoiceRoute[]) => {
      if (ids.length === 0) return;
      const reads = readsLfo(routes);
      ids.forEach((id) => (reads ? lfoVoices.add(id) : lfoVoices.delete(id)));
      feed.use(lfoVoices.size > 0);
      enqueue({ kind: 'routes', voices: ids, routes });
    },
    setFilter: (ids: number[], filter: VoiceFilterOptions | null) => {
      if (ids.length > 0) enqueue({ kind: 'filter', voices: ids, filter });
    },
    setVelocity: (ids: number[], velocity: VoiceVelocity) => {
      if (ids.length > 0) enqueue({ kind: 'velocity', voices: ids, velocity });
    },
    // the pitch bend of every voice (cents on top of their detunes), new ones start with it: the node glides there
    setBend: (cents: number) => {
      bend = cents;
      enqueue({ kind: 'bend', cents });
    },
    // the LFOs of every voice from `state.at` on (their tables only when they changed), while a voice reads one
    // (the LFOs as they are first, once one does); a node made later (ready, Retry) takes the last ones at once
    setLfos: (state: LfosState) => feed.take(state),
    // the events of this task to the node now (the specs)
    flush,
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
      teardown(false);
      $status.complete();
      $tables.complete();
    },
  };
};
