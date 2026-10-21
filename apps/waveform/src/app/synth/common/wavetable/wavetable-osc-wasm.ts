import type { EnvelopeParams } from '../envelope/envelope-curve';
import { CoreExports, createView } from '../wasm/wasm-core';
import type {
  BuilderPortMessage,
  StoreAbortMessage,
  StoreAckMessage,
  StoreBeginMessage,
  StoreChunkMessage,
  StoreChunksMessage,
} from './wavetable-builder';
import {
  StatsRequest,
  StoreTableMessage,
  TableStoreStats,
  UNISON_SHAPE,
  UNISON_DETUNES,
  UNISON_STACKS,
  VoiceFilterOptions,
  VoiceOptions,
  VoiceRoute,
  VoiceStats,
} from './voice-options';
import type { WavetableLevels } from './wavetable-levels';
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
  osc_store_chunk: (store: number, slot: number, at: number, length: number) => number;
  osc_store_commit: (store: number, slot: number) => number;
  osc_store_abort: (store: number, slot: number) => void;
  osc_store_remove: (store: number, table: number) => void;
  osc_store_latest: (store: number, table: number) => number;
  osc_store_acquire: (store: number, entry: number) => void;
  osc_store_release: (store: number, entry: number) => void;
  osc_store_stats: (store: number) => void;
  osc_store_track_freed: (store: number, on: boolean) => void;
  osc_store_freed: (store: number) => number;
  osc_store_freed_bytes: (store: number) => number;
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
// worker sends them one at a time, abort drops a version that won't be committed); onFree gets the levels of a
// version once no voice plays it (the specs: the store keeps the levels set to give them back, the worklet passes
// none and keeps nothing). `epoch` counts the workers it took chunks from (reset: a new one). listen() gets the
// bytes of the versions the core frees (the store processor tells the main thread: a version it refused may fit
// now)
export const createTableStoreWasm = (scope: OscScope, onFree?: (levels: WavetableLevels) => void) => {
  const { exports } = scope;
  const handle = exports.osc_store_new();
  const dataView = createView(exports);
  const kept = new Map<string, WasmTableEntry>();
  const latest = new Map<string, WasmTableEntry>();
  if (onFree) exports.osc_store_track_freed(handle, true);
  // (a field of the store read through a view: no call per block)
  const freedView = createView(exports, Float64Array);
  const freedAt = exports.osc_store_freed_bytes(handle);
  let onFreedBytes: ((bytes: number) => void) | null = null;

  // the versions the core freed since the last call (after every call that may free one: a block of a voice too)
  const drain = () => {
    if (onFreedBytes) {
      const freed = freedView(freedAt, 1);
      if (freed[0] !== 0) {
        const bytes = freed[0];
        freed[0] = 0;
        onFreedBytes(bytes);
      }
    }
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
  // `chunk` into the data of the slot from sample `at`: the chunks of a slot come in order, within the length of
  // its version (throws otherwise, and without the slot)
  const write = (slot: number, at: number, chunk: Float32Array) => {
    const pointer = exports.osc_store_chunk(handle, slot, at, chunk.length);
    if (pointer === 0)
      throw new Error(`The chunk of ${chunk.length} at ${at} is not the next one of slot ${slot}`);
    dataView(pointer, chunk.length).set(chunk);
  };
  // false: refused (a chunk is missing or no memory for it, the slot is aborted)
  const commit = (slot: number) => {
    const committed = exports.osc_store_commit(handle, slot) !== 0;
    drain();
    return committed;
  };
  let epoch = 0;

  return {
    handle,
    drain,
    begin,
    write,
    commit,
    abort: (slot: number) => exports.osc_store_abort(handle, slot),
    get epoch() {
      return epoch;
    },
    listen: (listener: ((bytes: number) => void) | null) => {
      onFreedBytes = listener;
    },
    // a new worker: the versions the last one was sending won't come
    reset: () => {
      exports.osc_store_abort(handle, -1);
      return ++epoch;
    },
    // a version at once (false: refused, no memory for it)
    set: (table: string, version: number, levels: WavetableLevels) => {
      const { frames, harmonics, lengths, offsets, data } = levels;
      const slot = begin(table, version, { frames, harmonics, lengths, offsets, length: data.length });
      if (slot === null) return false;
      try {
        write(slot, 0, data);
      } catch (error) {
        exports.osc_store_abort(handle, slot);
        throw error;
      }
      const key = `${scope.id(table)}:${version}`;
      const previous = latest.get(table);
      if (onFree) {
        // a stale version (older than the latest) is freed by the commit
        const entry = { table, version, levels, id: -1 };
        kept.set(key, entry);
        if (!previous || previous.version < version) latest.set(table, entry);
      }
      if (!commit(slot)) {
        kept.delete(key);
        if (previous) latest.set(table, previous);
        else latest.delete(table);
        return false;
      }
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

// the budget of the mix builds of a block of the core (MIX_BUDGET_WASM of dsp/wavetable-osc/src/shared.rs): it
// builds a mix about twice as fast as the TS (MIX_BUDGET 200000); the most whose longest block of the attack of a
// chord is not longer than the one of the TS
export const WASM_MIX_BUDGET = 360000;

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
  envelopes.forEach(({ attack, hold, decay, sustain, release, curves }) => {
    command[at++] = attack;
    command[at++] = hold;
    command[at++] = decay;
    command[at++] = sustain;
    command[at++] = release;
    command[at++] = curves?.attack ?? 0;
    command[at++] = curves?.decay ?? 0;
    command[at++] = curves?.release ?? 0;
  });
  return at;
};

// createVoiceDsp in the core: random() draws the start phases of the unison voices of each oscillator on, in
// their order, as the TS voice drew them, then the shares of a random detune
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
    const shape = osc?.unisonShape ?? UNISON_SHAPE;
    command[at++] = shape.blend;
    command[at++] = shape.width;
    command[at++] = UNISON_STACKS.indexOf(shape.stack);
    command[at++] = UNISON_DETUNES.indexOf(shape.detune);
    const randomDetune = osc !== null && shape.detune === 'random';
    command[at++] = shape.positionSpread;
    // (drawn after the phases, only for a random detune: the phases of a linear one stay those of before)
    for (let v = 0; v < MAX_UNISON; v++) command[at++] = randomDetune ? random() : 0;
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

  // (freed even when its end traps: the core gives back what it can, the handle doesn't stay)
  const end = () => {
    ended = true;
    try {
      startedAt = exports.osc_voice_started_at(handle);
      exports.osc_voice_end(handle, store.handle, shared.handle);
    } finally {
      exports.osc_voice_free(handle);
      store.drain();
    }
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
      // (guarded here, not by instantiateCore: no closure per block; osc_io grows the io)
      const stack = exports.__stack_pointer.value;
      let playing: number;
      try {
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

// store → main thread: a version the core had no memory for (the latest one plays on), and the bytes of versions
// it freed since (a refused one may fit now)
export interface StoreRefusedMessage {
  refused: string;
  version: number;
}
export interface StoreFreedBytesMessage {
  freedBytes: number;
}

type Port = Pick<MessagePort, 'postMessage'> & { onmessage: ((event: MessageEvent) => void) | null };
type StoreMessage =
  | BuilderPortMessage
  | StatsRequest
  | StoreTableMessage
  | StoreBeginMessage
  | StoreChunkMessage
  | StoreAbortMessage;

// the messages of the store processor of the wasm worklet, from its node (the port of the worker, a stats request,
// a version posted whole) and from the worker (versions in chunks, removals, a version it stopped sending):
// `reply` posts to the main thread (`stored`, `refused`), `stats` answers a stats request. A chunk is acked
// whatever happens to it (the worker sends the next one then); a chunk that fails (a trap of the core, a slot that
// is gone) aborts its version: refused. The port of a new worker (a retry) aborts the versions the old one was
// sending, and the receiver of the processor before it (a store node of before the retry) drops what still
// comes to it: its slots may be another version's by then
export const createStoreReceiver = (
  store: TableStoreWasm,
  reply: (message: { stored: string; version: number } | StoreRefusedMessage) => void,
  stats: () => void
) => {
  let worker: Port | null = null;
  let epoch = -1;
  // the slots of the versions coming in chunks (null: refused)
  const slots = new Map<string, number | null>();
  const chunk = (key: string, slot: number | null, data: StoreChunkMessage) => {
    try {
      if (slot === null) return false;
      store.write(slot, data.at, new Float32Array(data.chunk, 0, data.length));
      return !data.last || store.commit(slot);
    } catch (error) {
      console.error(`A chunk of the table ${key} failed`, error);
      store.abort(slot as number);
      return false;
    } finally {
      const ack: StoreAckMessage = { ack: data.chunk };
      worker?.postMessage(ack, [data.chunk]);
    }
  };
  const receive = ({ data }: MessageEvent<StoreMessage>) => {
    if ('port' in data) {
      slots.clear();
      epoch = store.reset();
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
    if (('begin' in data || 'chunk' in data || 'abort' in data) && epoch !== store.epoch) return;
    if ('begin' in data) {
      slots.set(key, store.begin(table, version, data.begin));
      return;
    }
    if ('abort' in data) {
      const slot = slots.get(key);
      slots.delete(key);
      if (slot !== undefined && slot !== null) store.abort(slot);
      return;
    }
    if ('chunk' in data) {
      const slot = slots.get(key) ?? null;
      const ok = chunk(key, slot, data);
      if (!ok) slots.set(key, null);
      if (!data.last) return;
      slots.delete(key);
      reply(ok ? { stored: table, version } : { refused: table, version });
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
