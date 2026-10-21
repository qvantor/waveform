import { expandFrames, playedFrames } from './wavetable-frames';
import { buildLevels, tableBytes } from './wavetable-mipmap';
import type { WavetableLevels } from './wavetable-levels';
import type { StatsRequest, StoreFreedMessage, StoreTableMessage } from './voice-options';

// the worker that builds the levels of the tables (wavetable.worker.ts): the main thread posts it the port of
// the store (a MessageChannel to the store processor of the worklet) and the frames of each new version of a
// table, it posts the levels to the store, their buffer transferred. A version that arrives while an older
// one of the table waits replaces it (an edited frame rebuilds the whole table). The store hands back the
// buffers of the versions no voice plays anymore, a table of the same size reuses one.
// The store of the wasm core keeps the tables in the memory of its core: it asks for chunks (StoreChunksMessage)
// once it has the port. Then a version goes as its layout (begin) and chunks of that many samples, one at a time:
// the next once the store has copied the last and handed its buffer back (ack), so a copy never holds the audio
// thread for long. Then the levels are freed at once (`transfer(0)` detaches their buffer): kept for the next
// build, or left to a GC of the worker, which may not come while it idles, a table of 256 frames stayed in it
// next to its copy in the core (S5: +68 MB)

// store → worker: send the versions in chunks of `chunks` samples
export interface StoreChunksMessage {
  chunks: number;
}
// worker → store: a version in chunks, its layout first, then its data from sample `at` (`length` samples of the
// chunk), the last one `last`; store → worker: a chunk copied, its buffer back
export interface StoreBeginMessage {
  table: string;
  version: number;
  begin: Omit<WavetableLevels, 'data'> & { length: number };
}
export interface StoreChunkMessage {
  table: string;
  version: number;
  chunk: ArrayBuffer;
  at: number;
  length: number;
  last: boolean;
}
export interface StoreAckMessage {
  ack: ArrayBuffer;
}
// worker → store: a version it stopped sending (its chunks failed): the store drops its slot
export interface StoreAbortMessage {
  table: string;
  version: number;
  abort: true;
}

// main thread → worker: the port of the store, then the tables
export interface BuilderPortMessage {
  port: MessagePort;
}
export interface BuildMessage {
  table: string;
  version: number;
  frames: Float32Array[];
  // the frames play expanded to 256 by crossfades (a morph mark)
  morph?: boolean;
}
export type BuilderMessage = BuilderPortMessage | BuildMessage | StoreTableMessage | StatsRequest;

// worker → main thread: the answer to a StatsRequest (the perf test hook): the tables waiting, the freed
// buffers kept and their bytes, the builds and their milliseconds
export interface BuilderStats {
  pending: number;
  pooled: number;
  pool: number;
  builds: number;
  lastMs: number;
  totalMs: number;
  maxMs: number;
}
export interface BuilderStatsMessage {
  stats: BuilderStats;
}
// worker → main thread: a version that failed to build or to go to the store (no memory for its levels, say): its
// table keeps the version before it, the next tables are built
export interface BuilderFailedMessage {
  failed: string;
  version: number;
  reason: string;
}
type BuilderReply = BuilderStatsMessage | BuilderFailedMessage;

type Port = Pick<MessagePort, 'postMessage'> & { onmessage: ((event: MessageEvent) => void) | null };

const finiteFrame = (frame: Float32Array) => {
  for (let i = 0; i < frame.length; i++) if (!Number.isFinite(frame[i])) frame[i] = 0;
};

// freed buffers kept for reuse at most (64 MB each)
const POOL = 2;

export const createTableBuilder = (
  schedule: (run: () => void) => void = (run) => setTimeout(run),
  reply: (message: BuilderReply) => void = () => undefined
) => {
  let store: Port | null = null;
  const pending = new Map<string, BuildMessage | StoreTableMessage>();
  const freed: ArrayBuffer[] = [];
  let scheduled = false;
  const timing = { builds: 0, lastMs: 0, totalMs: 0, maxMs: 0 };
  // the samples of a chunk (0: the store takes whole versions), the version being sent and the buffers of the chunks
  let chunkSize = 0;
  let transfer: { table: string; version: number; levels: WavetableLevels; at: number } | null = null;
  const chunks: ArrayBuffer[] = [];

  const keep = (buffer: ArrayBuffer) => {
    freed.push(buffer);
    if (freed.length > POOL) freed.shift();
  };

  const sendChunk = (port: Port) => {
    if (!transfer) return;
    const { table, version, levels, at } = transfer;
    const length = Math.min(chunkSize, levels.data.length - at);
    const buffer = chunks.pop() ?? new ArrayBuffer(chunkSize * Float32Array.BYTES_PER_ELEMENT);
    new Float32Array(buffer, 0, length).set(levels.data.subarray(at, at + length));
    transfer.at += length;
    const chunk: StoreChunkMessage = {
      table,
      version,
      chunk: buffer,
      at,
      length,
      last: transfer.at >= levels.data.length,
    };
    port.postMessage(chunk, [buffer]);
  };

  // (without ArrayBuffer.prototype.transfer, Safari before 17.4, a GC frees it)
  const release = (buffer: ArrayBuffer) =>
    (buffer as ArrayBuffer & { transfer?: (length: number) => ArrayBuffer }).transfer?.(0);

  const fail = (table: string, version: number, error: unknown) => {
    const failed: BuilderFailedMessage = { failed: table, version, reason: String(error) };
    reply(failed);
  };

  // the next chunk of the version being sent; one that fails stops it: the store drops its slot
  const sendNext = (port: Port) => {
    try {
      sendChunk(port);
    } catch (error) {
      if (!transfer) return;
      const { table, version, levels } = transfer;
      const abort: StoreAbortMessage = { table, version, abort: true };
      port.postMessage(abort);
      release(levels.data.buffer as ArrayBuffer);
      transfer = null;
      fail(table, version, error);
      later();
    }
  };

  const reuse = (bytes: number) => {
    const index = freed.findIndex((buffer) => buffer.byteLength === bytes);
    return index === -1 ? undefined : freed.splice(index, 1)[0];
  };

  // the levels of the frames played (expanded with a morph); a buffer reused goes back to the pool when they fail
  const build = (own: Float32Array[], morph: boolean) => {
    const frames = playedFrames(own.length, morph) === own.length ? own : expandFrames(own);
    const buffer = reuse(tableBytes(frames));
    try {
      return buildLevels(frames, buffer);
    } catch (error) {
      if (buffer) keep(buffer);
      throw error;
    }
  };

  const flush = () => {
    scheduled = false;
    // a version in chunks goes on first, the next ones wait for it
    if (!store || transfer) return;
    for (const [table, message] of pending) {
      pending.delete(table);
      if (!('frames' in message)) {
        store.postMessage(message);
        continue;
      }
      const begin = __PERF__ ? performance.now() : 0;
      const { frames: own, morph = false } = message;
      // (a sample that is not finite as 0: the frames come from the editors too, a NaN would play in every level)
      own.forEach(finiteFrame);
      let levels: WavetableLevels;
      try {
        levels = build(own, morph);
      } catch (error) {
        // (an allocation that failed: the table keeps its version before, the next tables are built)
        fail(table, message.version, error);
        continue;
      }
      if (__PERF__) {
        const ms = performance.now() - begin;
        timing.builds++;
        timing.lastMs = ms;
        timing.totalMs += ms;
        timing.maxMs = Math.max(timing.maxMs, ms);
      }
      if (chunkSize > 0) {
        const { frames, harmonics, lengths, offsets, data } = levels;
        transfer = { table, version: message.version, levels, at: 0 };
        const begin: StoreBeginMessage = {
          table,
          version: message.version,
          begin: { frames, harmonics, lengths, offsets, length: data.length },
        };
        store.postMessage(begin);
        sendNext(store);
        return;
      }
      const stored: StoreTableMessage = { table, version: message.version, levels };
      store.postMessage(stored, [levels.data.buffer]);
    }
  };
  const later = () => {
    if (scheduled) return;
    scheduled = true;
    schedule(flush);
  };

  return {
    receive: (message: BuilderMessage) => {
      if ('port' in message) {
        const port = message.port;
        store = port;
        // a store of its own: it asks for chunks again, a version being sent to the old one is dropped
        chunkSize = 0;
        transfer = null;
        chunks.length = 0;
        port.onmessage = ({
          data,
        }: MessageEvent<StoreFreedMessage & StoreChunksMessage & StoreAckMessage>) => {
          if (store !== port) return;
          if (data.freed) keep(data.freed);
          if (data.chunks) chunkSize = data.chunks;
          if (!data.ack) return;
          chunks.push(data.ack);
          if (!transfer) return;
          if (transfer.at < transfer.levels.data.length) {
            sendNext(port);
            return;
          }
          // the last chunk is in the store: its levels are freed
          release(transfer.levels.data.buffer as ArrayBuffer);
          transfer = null;
          later();
        };
        later();
        return;
      }
      if ('stats' in message) {
        // (the perf build)
        if (!__PERF__) return;
        const pool = freed.reduce((bytes, buffer) => bytes + buffer.byteLength, 0);
        reply({ stats: { pending: pending.size, pooled: freed.length, pool, ...timing } });
        return;
      }
      pending.set(message.table, message);
      later();
    },
  };
};
