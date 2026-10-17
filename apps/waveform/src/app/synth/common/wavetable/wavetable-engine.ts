import { BehaviorSubject } from 'rxjs';
import { isWorkletSupported, loadWorklet, WORKLETS_PATH } from '../../fx/effects/load-worklet';
import type { BuilderPortMessage, BuildMessage } from './wavetable-builder';
import type { StoreTableMessage, VoiceOptions } from './wavetable-osc-dsp';
import { STORE_PROCESSOR, VOICE_PROCESSOR, VoiceParam } from './wavetable-osc-params';

// the worklet module (wavetable-osc.worklet.ts) and the worker (wavetable.worker.ts), bundled by `npm run
// worklets` into assets/worklets/
export const WAVETABLE_WORKLET = 'wavetable-osc';
export const WAVETABLE_WORKER = 'wavetable-worker';

// loading: the module is being added; unsupported: no AudioWorklet (http on a LAN IP, old Safari) or no
// Worker; failed: the module, the worker or a processor failed, retry() loads it again. Without it the synth
// doesn't play: there is no native fallback
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
  const tables = new Map<string, { version: number; frames: ArrayLike<number>[] }>();
  let store: AudioWorkletNode | null = null;
  let worker: Worker | null = null;
  let destroyed = false;

  const teardown = () => {
    worker?.terminate();
    worker = null;
    store?.disconnect();
    store = null;
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
    const message: BuildMessage = { table, version: entry.version, frames };
    worker.postMessage(
      message,
      frames.map(({ buffer }) => buffer)
    );
  };

  const load = () => {
    if (!isWorkletSupported(audioCtx) || typeof Worker === 'undefined' || !createChannel) {
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
        const created = createWorker(
          new URL(`${WORKLETS_PATH}${WAVETABLE_WORKER}.js`, document.baseURI).href
        );
        created.onerror = (event) => {
          if (worker === created) fail(event);
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
    // a new version of the table (the frames of the model, read when it is sent)
    setTable: (table: string, frames: ArrayLike<number>[]) => {
      tables.set(table, { version: (tables.get(table)?.version ?? 0) + 1, frames });
      send(table);
    },
    // the table is gone (its oscillator was destroyed): the store frees it once no voice plays it
    removeTable: (table: string) => {
      const entry = tables.get(table);
      tables.delete(table);
      if (!entry || !worker) return;
      const message: StoreTableMessage = { table, version: entry.version + 1, remove: true };
      worker.postMessage(message);
    },
    createVoice: (options: VoiceOptions, parameterData: Partial<Record<VoiceParam, number>>) => {
      if ($status.value !== 'ready') return null;
      const node = new AudioWorkletNode(audioCtx, VOICE_PROCESSOR, {
        ...VOICE_NODE_OPTIONS,
        processorOptions: options,
        parameterData,
      });
      // the processor threw: the voices are silent from now on, a retry starts it again
      node.onprocessorerror = fail;
      return node;
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
