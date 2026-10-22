import { registrar } from 'standardized-audio-context-mock';
import { BuilderMessage, createTableBuilder } from '../app/synth/common/wavetable/wavetable-builder';
import type { StoreTableMessage } from '../app/synth/common/wavetable/voice-options';
import { STORE_PROCESSOR } from '../app/synth/common/wavetable/wavetable-osc-params';
import {
  createTableStoreWasm,
  createVoiceScopeWasm,
  createVoiceSharedWasm,
} from '../app/synth/common/wavetable/wavetable-osc-wasm';
import { eventsOf, VoicesNodeStub, voicesNodes } from './voice-events';
import { BLOCK, oscScope, seeded } from './voice-dsp';
import { WorkerStub } from './worker-stub';

// the wavetable oscillator of the models run offline: the worker's builder, the store and the voices of the voices
// node (the Rust core, one instance as one scope), as the worker and the worklet would run them. Create it before
// the synth core (it installs the worker); the builds run when flushWorker() says so (a note meanwhile plays the
// previous version), render() takes the events the main thread sent the node (their params by the timelines of
// the core), renders its voices block by block, tells the node their starts and ends and moves the context time on

interface StoreNode extends AudioWorkletNode {
  name: string;
  port: AudioWorkletNode['port'] & { onmessage: ((event: { data: unknown }) => void) | null };
}

export const createOfflineEngine = (random = seeded(1)) => {
  const queue: (() => void)[] = [];
  const replies: unknown[] = [];
  const builder = createTableBuilder(
    (run) => queue.push(run),
    (message) => replies.push(message)
  );
  // the worker's end of the channel to the store
  const builderPort = {
    onmessage: null as null | ((event: MessageEvent) => void),
    postMessage: (message: StoreTableMessage) => {
      if (message.remove) store.remove(message.table);
      else if (message.levels) store.set(message.table, message.version, message.levels);
      storeNode?.port.onmessage?.({ data: { stored: message.table, version: message.version } });
    },
  };
  // (the store keeps the versions in the memory of the core: it hands nothing back to the worker)
  const scope = oscScope();
  const store = createTableStoreWasm(scope);
  const shared = createVoiceSharedWasm(scope);
  let storeNode: StoreNode | null = null;
  let audioCtx: BaseAudioContext | null = null;
  // the events of a task of the main thread go when its microtask would send them
  let flushEvents = () => undefined as void;

  class OfflineWorker extends WorkerStub {
    override postMessage = jest.fn((message: BuilderMessage) =>
      builder.receive('port' in message ? { port: builderPort as unknown as MessagePort } : message)
    );
  }
  Object.assign(globalThis, { Worker: OfflineWorker });

  // the voices of each voices node, and the messages of events taken from it
  const nodes = new Map<VoicesNodeStub, { voices: ReturnType<typeof createVoiceScopeWasm>; read: number }>();
  let made = 0;
  const outL = new Float32Array(BLOCK);
  const outR = new Float32Array(BLOCK);

  // the voices nodes created since the last block get their voices
  const discover = (context: BaseAudioContext) => {
    const workletNodes = registrar.getAudioNodes(
      context as never,
      'AudioWorkletNode' as never
    ) as unknown as StoreNode[];
    storeNode = workletNodes.find(({ name }) => name === STORE_PROCESSOR) ?? storeNode;
    voicesNodes(context)
      .filter((node) => !nodes.has(node))
      .forEach((node) =>
        nodes.set(node, {
          voices: createVoiceScopeWasm(scope, context.sampleRate, store, shared, random),
          read: 0,
        })
      );
  };

  return {
    store,
    shared,
    // the context of the synth core (render needs it) and its wavetable oscillator
    attach: (context: BaseAudioContext, engine: { flush: () => void }) => {
      audioCtx = context;
      flushEvents = engine.flush;
      discover(context);
    },
    flushWorker: () => queue.splice(0).forEach((run) => run()),
    // the worker's freed buffers kept for reuse
    pool: () => {
      replies.length = 0;
      builder.receive({ stats: true });
      return (replies[0] as { stats: { pooled: number; pool: number } }).stats;
    },
    render: (blocks = 1) => {
      const context = audioCtx as BaseAudioContext;
      for (let i = 0; i < blocks; i++) {
        flushEvents();
        discover(context);
        const frame = Math.round(context.currentTime * context.sampleRate);
        nodes.forEach((entry, node) => {
          const messages = eventsOf(node);
          messages.slice(entry.read).forEach(({ events }) => {
            made += events.filter(({ kind }) => kind === 'on').length;
            entry.voices.apply(events);
          });
          entry.read = messages.length;
          entry.voices.process(frame, outL, outR);
          const report = entry.voices.reports();
          if (report) node.port.onmessage?.({ data: report });
        });
        registrar.getDeLorean(context as never)?.travel(BLOCK / context.sampleRate);
      }
    },
    // the voices playing, and those made so far
    alive: () => [...nodes.values()].reduce((sum, { voices }) => sum + voices.stats().voices, 0),
    made: () => made,
  };
};
