import { registrar } from 'standardized-audio-context-mock';
import { BuilderMessage, createTableBuilder } from '../app/synth/common/wavetable/wavetable-builder';
import type { StoreTableMessage, VoiceOptions } from '../app/synth/common/wavetable/voice-options';
import {
  STORE_PROCESSOR,
  VOICE_PARAMETERS,
  VOICE_PROCESSOR,
} from '../app/synth/common/wavetable/wavetable-osc-params';
import {
  createTableStoreWasm,
  createVoiceSharedWasm,
  createVoiceWasm,
} from '../app/synth/common/wavetable/wavetable-osc-wasm';
import { BLOCK, oscScope, seeded } from './voice-dsp';
import { WorkerStub } from './worker-stub';

// the wavetable oscillator of the models run offline: the worker's builder, the store and a voice per voice node
// (the Rust core, one instance as one scope), as the worker and the worklet would run them. Create it before the synth core (it installs the
// worker); the builds run when flushWorker() says so (a note meanwhile plays the previous version), render()
// processes the voices block by block and moves the context time on. The params are read once a block
// (k-rate: a gate that closes within a block ends the voice at most a block later)

interface VoiceNode extends AudioWorkletNode {
  name: string;
  options: AudioWorkletNodeOptions;
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
  let storeNode: VoiceNode | null = null;
  let audioCtx: BaseAudioContext | null = null;

  class OfflineWorker extends WorkerStub {
    override postMessage = jest.fn((message: BuilderMessage) =>
      builder.receive('port' in message ? { port: builderPort as unknown as MessagePort } : message)
    );
  }
  Object.assign(globalThis, { Worker: OfflineWorker });

  const voices = new Map<VoiceNode, { dsp: ReturnType<typeof createVoiceWasm>; ended: boolean }>();
  const outL = new Float32Array(BLOCK);
  const outR = new Float32Array(BLOCK);

  // the voice nodes created since the last block get their dsp
  const discover = (context: BaseAudioContext) => {
    const nodes = registrar.getAudioNodes(
      context as never,
      'AudioWorkletNode' as never
    ) as unknown as VoiceNode[];
    storeNode = nodes.find(({ name }) => name === STORE_PROCESSOR) ?? storeNode;
    nodes
      .filter((node) => node.name === VOICE_PROCESSOR && !voices.has(node))
      .forEach((node) =>
        voices.set(node, {
          dsp: createVoiceWasm(
            scope,
            context.sampleRate,
            node.options.processorOptions as VoiceOptions,
            store,
            random,
            shared
          ),
          ended: false,
        })
      );
  };

  const values = (node: VoiceNode) =>
    Object.fromEntries(
      VOICE_PARAMETERS.map(({ name }) => [
        name,
        Float32Array.of((node.parameters.get(name) as AudioParam).value),
      ])
    ) as Parameters<ReturnType<typeof createVoiceWasm>['process']>[1];

  return {
    store,
    shared,
    // the context of the synth core (render needs it)
    attach: (context: BaseAudioContext) => {
      audioCtx = context;
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
        discover(context);
        const frame = Math.round(context.currentTime * context.sampleRate);
        voices.forEach((voice, node) => {
          if (voice.ended) return;
          voice.ended = !voice.dsp.process(frame, values(node), outL, outR);
          if (voice.ended) node.port.onmessage?.({ data: { ended: true } });
        });
        registrar.getDeLorean(context as never)?.travel(BLOCK / context.sampleRate);
      }
    },
    alive: () => [...voices.values()].filter(({ ended }) => !ended).length,
    nodes: () => [...voices.keys()],
  };
};
