import { buildLevels, tableBytes } from './wavetable-mipmap';
import type { StoreFreedMessage, StoreTableMessage } from './wavetable-osc-dsp';

// the worker that builds the levels of the tables (wavetable.worker.ts): the main thread posts it the port of
// the store (a MessageChannel to the store processor of the worklet) and the frames of each new version of a
// table, it posts the levels to the store, their buffer transferred. A version that arrives while an older
// one of the table waits replaces it (an edited frame rebuilds the whole table). The store hands back the
// buffers of the versions no voice plays anymore, a table of the same size reuses one

// main thread → worker: the port of the store, then the tables
export interface BuilderPortMessage {
  port: MessagePort;
}
export interface BuildMessage {
  table: string;
  version: number;
  frames: Float32Array[];
}
export type BuilderMessage = BuilderPortMessage | BuildMessage | StoreTableMessage;

type Port = Pick<MessagePort, 'postMessage'> & { onmessage: ((event: MessageEvent) => void) | null };

// freed buffers kept for reuse at most (64 MB each)
const POOL = 2;

export const createTableBuilder = (schedule: (run: () => void) => void = (run) => setTimeout(run)) => {
  let store: Port | null = null;
  const pending = new Map<string, BuildMessage | StoreTableMessage>();
  const freed: ArrayBuffer[] = [];
  let scheduled = false;

  const reuse = (bytes: number) => {
    const index = freed.findIndex((buffer) => buffer.byteLength === bytes);
    return index === -1 ? undefined : freed.splice(index, 1)[0];
  };

  const flush = () => {
    scheduled = false;
    if (!store) return;
    for (const [table, message] of pending) {
      pending.delete(table);
      if (!('frames' in message)) {
        store.postMessage(message);
        continue;
      }
      const levels = buildLevels(message.frames, reuse(tableBytes(message.frames)));
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
        store = message.port;
        store.onmessage = ({ data }: MessageEvent<StoreFreedMessage>) => {
          if (!data.freed) return;
          freed.push(data.freed);
          if (freed.length > POOL) freed.shift();
        };
        later();
        return;
      }
      pending.set(message.table, message);
      later();
    },
  };
};
