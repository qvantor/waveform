import type { EnvelopeParams } from '../envelope/envelope-curve';
import { CoreExports, createView } from '../wasm/wasm-core';
import type {
  BuilderPortMessage,
  StoreAckMessage,
  StoreBeginMessage,
  StoreChunkMessage,
  StoreChunksMessage,
} from './wavetable-builder';
import type { VoiceRoute } from './voice-modulation';
import type { VoiceFilterOptions } from './voice-filter';
import type { WavetableLevels } from './wavetable-levels';
import type {
  StatsRequest,
  StoreTableMessage,
  TableStoreStats,
  VoiceOptions,
  VoiceStats,
} from './wavetable-osc-dsp';
import type { VoiceParam } from './wavetable-osc-params';

// the Rust core of the wavetable oscillator (dsp/wavetable-osc, wavetable-osc.wasm): the store of the tables in the
// memory of the core, the voices and what they share, with the API of createTableStore, createVoiceShared and
// createVoiceDsp. A scope is one instance (one AudioWorkletGlobalScope: its memory), its stores, shareds and
// voices are handles into it. No import of wavetable-osc-dsp.ts but its types: the wasm bundle has no TS core

export interface OscExports extends CoreExports {
  osc_command: () => number;
  osc_store_new: () => number;
  osc_store_free: (store: number) => void;
  osc_store_begin: (
    store: number,
    table: number,
    version: number,
    frames: number,
    levels: number,
    length: number
  ) => number;
  osc_store_data: (store: number, slot: number) => number;
  osc_store_commit: (store: number, slot: number) => void;
  osc_store_remove: (store: number, table: number) => void;
  osc_store_latest: (store: number, table: number) => number;
  osc_store_acquire: (store: number, entry: number) => void;
  osc_store_release: (store: number, entry: number) => void;
  osc_store_stats: (store: number) => void;
  osc_store_track_freed: (store: number, on: boolean) => void;
  osc_store_freed: (store: number) => number;
  osc_shared_new: () => number;
  osc_shared_free: (shared: number) => void;
  osc_shared_stats: (shared: number) => void;
  osc_io: (shared: number, frames: number) => number;
  osc_io_stride: (shared: number) => number;
  osc_io_lengths: (shared: number) => number;
  osc_io_output: (shared: number) => number;
  osc_voice_new: (sampleRate: number, store: number, shared: number) => number;
  osc_voice_free: (voice: number) => void;
  osc_voice_process: (voice: number, store: number, shared: number, frame: number, frames: number) => number;
  osc_voice_set_routes: (voice: number) => void;
  osc_voice_set_filter: (voice: number) => void;
  osc_voice_end: (voice: number, store: number, shared: number) => void;
  osc_voice_ended: (voice: number) => number;
  osc_voice_started_at: (voice: number) => number;
  osc_voice_start_frame: (voice: number) => number;
}

// the size of the command buffer of the core (dsp/wavetable-osc/src/lib.rs)
const COMMAND_SIZE = 4096;
const MAX_UNISON = 8;

// the params of a block in the order of VOICE_PARAMETERS (the core reads them so)
export const VOICE_PARAM_ORDER: readonly VoiceParam[] = [
  'frequency',
  'gate',
  'position1',
  'detune1',
  'spread1',
  'gain1',
  'position2',
  'detune2',
  'spread2',
  'gain2',
];
// the params a route moves, by their id in the core (another name: none, the route is left out)
const ROUTE_PARAMS = [
  'position1',
  'spread1',
  'gain1',
  'position2',
  'spread2',
  'gain2',
  'cutoff',
  'resonance',
  'gain',
];
// BiquadFilterType by its index in the core (another type: a constant 1)
const FILTER_TYPES: readonly BiquadFilterType[] = [
  'lowpass',
  'highpass',
  'bandpass',
  'lowshelf',
  'highshelf',
  'peaking',
  'notch',
  'allpass',
];

export type OscScope = ReturnType<typeof createOscScope>;

// a scope of the core: its exports, the views on its memory, the ids of the tables (interned: the core takes
// numbers)
export const createOscScope = (exports: OscExports) => {
  const ids = new Map<string, number>();
  const commandView = createView(exports, Float64Array);
  return {
    exports,
    command: () => commandView(exports.osc_command(), COMMAND_SIZE),
    id: (table: string) => {
      const known = ids.get(table);
      if (known !== undefined) return known;
      ids.set(table, ids.size);
      return ids.size - 1;
    },
  };
};

// the layout of a version (WavetableLevels without its data)
export interface LevelsLayout {
  frames: number;
  harmonics: ArrayLike<number>;
  lengths: ArrayLike<number>;
  offsets: ArrayLike<number>;
  length: number;
}

// a version as latest() gives it (the specs compare it with the levels freed, hold it as a voice does)
export interface WasmTableEntry {
  table: string;
  version: number;
  levels: WavetableLevels;
  id: number;
}

// createTableStore in the memory of the core: set() copies a version in (begin, write, commit are its chunks: the
// worker sends them one at a time); onFree gets the levels of a version once no voice plays it (the specs: the
// store keeps the levels set to give them back, the worklet passes none and keeps nothing)
export const createTableStoreWasm = (scope: OscScope, onFree?: (levels: WavetableLevels) => void) => {
  const { exports } = scope;
  const handle = exports.osc_store_new();
  const dataView = createView(exports);
  const kept = new Map<string, WasmTableEntry>();
  const latest = new Map<string, WasmTableEntry>();
  if (onFree) exports.osc_store_track_freed(handle, true);

  // the versions the core freed since the last call
  const drain = () => {
    if (!onFree) return;
    const count = exports.osc_store_freed(handle);
    if (count === 0) return;
    const command = scope.command();
    for (let i = 0; i < count; i++) {
      const key = `${command[2 * i]}:${command[2 * i + 1]}`;
      const entry = kept.get(key);
      kept.delete(key);
      if (entry) onFree(entry.levels);
    }
  };

  const begin = (table: string, version: number, layout: LevelsLayout) => {
    const command = scope.command();
    const levels = layout.lengths.length;
    for (let k = 0; k < levels; k++) {
      command[k] = layout.harmonics[k];
      command[levels + k] = layout.lengths[k];
      command[2 * levels + k] = layout.offsets[k];
    }
    const slot = exports.osc_store_begin(
      handle,
      scope.id(table),
      version,
      layout.frames,
      levels,
      layout.length
    );
    return slot < 0 ? null : slot;
  };
  // `chunk` into the data of the slot from sample `at`
  const write = (slot: number, at: number, chunk: Float32Array) => {
    const pointer = exports.osc_store_data(handle, slot);
    dataView(pointer + 4 * at, chunk.length).set(chunk);
  };
  const commit = (slot: number) => {
    exports.osc_store_commit(handle, slot);
    drain();
  };

  return {
    handle,
    drain,
    begin,
    write,
    commit,
    // a version at once (false: refused, no memory for it)
    set: (table: string, version: number, levels: WavetableLevels) => {
      const { frames, harmonics, lengths, offsets, data } = levels;
      const slot = begin(table, version, { frames, harmonics, lengths, offsets, length: data.length });
      if (slot === null) return false;
      write(slot, 0, data);
      if (onFree) {
        // a stale version (older than the latest) is freed by the commit
        const entry = { table, version, levels, id: -1 };
        kept.set(`${scope.id(table)}:${version}`, entry);
        const current = latest.get(table);
        if (!current || current.version < version) latest.set(table, entry);
      }
      commit(slot);
      const current = latest.get(table);
      if (current && current.id < 0) current.id = exports.osc_store_latest(handle, scope.id(table));
      return true;
    },
    remove: (table: string) => {
      latest.delete(table);
      exports.osc_store_remove(handle, scope.id(table));
      drain();
    },
    // the latest version set (kept with onFree only)
    latest: (table: string) => latest.get(table) ?? null,
    // a holder more of a version, and one less (as a voice)
    acquire: (entry: WasmTableEntry) => {
      exports.osc_store_acquire(handle, entry.id);
      return entry;
    },
    release: (entry: WasmTableEntry) => {
      exports.osc_store_release(handle, entry.id);
      drain();
    },
    stats: (): TableStoreStats => {
      exports.osc_store_stats(handle);
      const [tables, versions, bytes] = scope.command();
      return { tables, versions, bytes };
    },
    // (once no voice plays from it)
    free: () => exports.osc_store_free(handle),
  };
};
export type TableStoreWasm = ReturnType<typeof createTableStoreWasm>;

// createVoiceShared in the core: the buffers, the mix tables, the budget and the counters of the voices of a scope
export const createVoiceSharedWasm = (scope: OscScope) => {
  const handle = scope.exports.osc_shared_new();
  return {
    handle,
    stats: (): VoiceStats => {
      scope.exports.osc_shared_stats(handle);
      const [
        voices,
        unison,
        mixSamples,
        directSamples,
        builds,
        buildCost,
        refused,
        peakCost,
        mixes,
        mixBytes,
      ] = scope.command();
      return {
        voices,
        unison,
        mixSamples,
        directSamples,
        builds,
        buildCost,
        refused,
        peakCost,
        mixes,
        mixBytes,
      };
    },
    // (once no voice of it is left)
    free: () => scope.exports.osc_shared_free(handle),
  };
};
export type VoiceSharedWasm = ReturnType<typeof createVoiceSharedWasm>;

const writeRoutes = (command: Float64Array, at: number, routes: VoiceRoute[]) => {
  command[at++] = routes.length;
  routes.forEach(({ env, param, amount, min, max, log }) => {
    const id = ROUTE_PARAMS.indexOf(param);
    command[at++] = env;
    command[at++] = id < 0 ? 255 : id;
    command[at++] = amount;
    command[at++] = min;
    command[at++] = max;
    command[at++] = log ? 1 : 0;
  });
  return at;
};

const writeFilter = (command: Float64Array, at: number, filter: VoiceFilterOptions | null) => {
  const type = filter ? FILTER_TYPES.indexOf(filter.type) : -1;
  command[at++] = filter ? 1 : 0;
  command[at++] = type < 0 ? 255 : type;
  command[at++] = filter?.cutoff ?? 0;
  command[at++] = filter?.resonance ?? 0;
  command[at++] = filter?.gain ?? 0;
  return at;
};

const writeEnvelopes = (command: Float64Array, at: number, envelopes: EnvelopeParams[]) => {
  command[at++] = envelopes.length;
  envelopes.forEach(({ attack, hold, decay, sustain, release }) => {
    command[at++] = attack;
    command[at++] = hold;
    command[at++] = decay;
    command[at++] = sustain;
    command[at++] = release;
  });
  return at;
};

// createVoiceDsp in the core: random() draws the start phases of the unison voices of each oscillator on, in
// their order, as the TS voice draws them
export const createVoiceWasm = (
  scope: OscScope,
  sampleRate: number,
  options: VoiceOptions,
  store: TableStoreWasm,
  random: () => number = Math.random,
  shared: VoiceSharedWasm
) => {
  const { exports } = scope;
  const command = scope.command();
  let at = 0;
  command[at++] = options.start;
  command[at++] = options.envStart;
  command[at++] = options.phrase;
  for (let index = 0; index < 2; index++) {
    const osc = options.osc[index] ?? null;
    command[at++] = osc ? 1 : 0;
    command[at++] = osc ? scope.id(osc.table) : 0;
    command[at++] = osc?.unison ?? 0;
    command[at++] = osc?.phase ?? 0;
    command[at++] = osc?.phaseRand ?? 0;
    for (let v = 0; v < MAX_UNISON; v++) command[at++] = osc ? random() : 0;
  }
  at = writeEnvelopes(command, at, options.envelopes);
  at = writeFilter(command, at, options.filter);
  writeRoutes(command, at, options.routes);
  const handle = exports.osc_voice_new(sampleRate, store.handle, shared.handle);
  const paramsView = createView(exports);
  const lengthsView = createView(exports);
  const [leftView, rightView] = [createView(exports), createView(exports)];
  let ended = false;
  // the frame it started at (-1 before), read when asked: the core frees the voice once it has ended
  let startedAt = -1;
  // the io of the shared (they move only when it grows: osc_io gives another pointer then)
  let io = -1;
  let stride = 0;
  let lengthsAt = 0;
  let output = 0;

  const end = () => {
    startedAt = exports.osc_voice_started_at(handle);
    exports.osc_voice_end(handle, store.handle, shared.handle);
    if (!ended) exports.osc_voice_free(handle);
    ended = true;
    store.drain();
  };

  return {
    // a block starting at `frame` into the outputs; false once the voice has ended
    process: (
      frame: number,
      params: Record<VoiceParam, Float32Array>,
      outL: Float32Array,
      outR: Float32Array
    ) => {
      const n = outL.length;
      if (ended) {
        outL.fill(0);
        outR.fill(0);
        return false;
      }
      const pointer = exports.osc_io(shared.handle, n);
      if (pointer !== io) {
        io = pointer;
        stride = exports.osc_io_stride(shared.handle);
        lengthsAt = exports.osc_io_lengths(shared.handle);
        output = exports.osc_io_output(shared.handle);
      }
      const data = paramsView(pointer, VOICE_PARAM_ORDER.length * stride);
      const lengths = lengthsView(lengthsAt, VOICE_PARAM_ORDER.length);
      for (let k = 0; k < VOICE_PARAM_ORDER.length; k++) {
        const values = params[VOICE_PARAM_ORDER[k]];
        if (values.length > 1) {
          lengths[k] = n;
          data.set(values, k * stride);
        } else {
          lengths[k] = 1;
          data[k * stride] = values[0];
        }
      }
      // (guarded: a trap leaves the stack pointer moved)
      const stack = exports.__stack_pointer.value;
      let playing: number;
      try {
        playing = exports.osc_voice_process(handle, store.handle, shared.handle, frame, n);
      } catch (error) {
        exports.__stack_pointer.value = stack;
        throw error;
      }
      outL.set(leftView(output, n));
      outR.set(rightView(output + 4 * n, n));
      if (!playing) end();
      else store.drain();
      return playing !== 0;
    },
    setRoutes: (routes: VoiceRoute[]) => {
      if (ended) return;
      writeRoutes(scope.command(), 0, routes);
      exports.osc_voice_set_routes(handle);
    },
    setFilter: (filter: VoiceFilterOptions | null) => {
      if (ended) return;
      writeFilter(scope.command(), 0, filter);
      exports.osc_voice_set_filter(handle);
    },
    // ends the voice at once (its process threw): the versions and the mixes it holds are given back
    end: () => {
      if (!ended) end();
    },
    get ended() {
      return ended;
    },
    startFrame: exports.osc_voice_start_frame(handle),
    get startedAt() {
      return ended ? startedAt : exports.osc_voice_started_at(handle);
    },
  };
};

// samples of a chunk of a version the worker sends (1 MB): its copy into the memory of the core takes a fraction of
// a render quantum, the chunks of 64 MB go between the blocks
export const STORE_CHUNK = 262144;

// store → main thread: a version the core had no memory for (the latest one plays on)
export interface StoreRefusedMessage {
  refused: string;
  version: number;
}

type Port = Pick<MessagePort, 'postMessage'> & { onmessage: ((event: MessageEvent) => void) | null };
type StoreMessage =
  | BuilderPortMessage
  | StatsRequest
  | StoreTableMessage
  | StoreBeginMessage
  | StoreChunkMessage;

// the messages of the store processor of the wasm worklet, from its node (the port of the worker, a stats request,
// a version posted whole) and from the worker (versions in chunks, removals): `reply` posts to the main thread
// (`stored`, `refused`), `stats` answers a stats request
export const createStoreReceiver = (
  store: TableStoreWasm,
  reply: (message: { stored: string; version: number } | StoreRefusedMessage) => void,
  stats: () => void
) => {
  let worker: Port | null = null;
  // the slots of the versions coming in chunks (null: refused)
  const slots = new Map<string, number | null>();
  const receive = ({ data }: MessageEvent<StoreMessage>) => {
    if ('port' in data) {
      worker = data.port;
      worker.onmessage = receive;
      const chunks: StoreChunksMessage = { chunks: STORE_CHUNK };
      worker.postMessage(chunks);
      return;
    }
    if ('stats' in data) {
      stats();
      return;
    }
    const { table, version } = data;
    const key = `${table}:${version}`;
    if ('begin' in data) {
      slots.set(key, store.begin(table, version, data.begin));
      return;
    }
    if ('chunk' in data) {
      const slot = slots.get(key) ?? null;
      if (slot !== null) store.write(slot, data.at, new Float32Array(data.chunk, 0, data.length));
      const ack: StoreAckMessage = { ack: data.chunk };
      worker?.postMessage(ack, [data.chunk]);
      if (!data.last) return;
      slots.delete(key);
      if (slot === null) {
        reply({ refused: table, version });
        return;
      }
      store.commit(slot);
      reply({ stored: table, version });
      return;
    }
    if (data.remove) store.remove(table);
    else if (data.levels && !store.set(table, version, data.levels)) {
      reply({ refused: table, version });
      return;
    }
    reply({ stored: table, version });
  };
  return receive;
};
