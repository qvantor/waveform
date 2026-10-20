import { createTableBuilder } from './wavetable-builder';
import { buildLevels, tableBytes } from './wavetable-mipmap';
import type { WavetableLevels } from './wavetable-levels';

const sine = Float32Array.from({ length: 2048 }, (_, n) => Math.sin((2 * Math.PI * n) / 2048));
const saw = Float32Array.from({ length: 2048 }, (_, n) => n / 1024 - 1);
const short = Float32Array.from({ length: 64 }, (_, n) => Math.sin((2 * Math.PI * n) / 64));

// the builds run when the test says so (setTimeout in the worker)
const setup = () => {
  const queue: (() => void)[] = [];
  const reply = jest.fn();
  const builder = createTableBuilder((run) => queue.push(run), reply);
  const port = { onmessage: null as null | ((event: { data: unknown }) => void), postMessage: jest.fn() };
  const run = () => queue.splice(0).forEach((task) => task());
  const connect = () => builder.receive({ port: port as unknown as MessagePort });
  const posted = () => port.postMessage.mock.calls.map(([message]) => message);
  // the answer to a stats request
  const stats = () => {
    reply.mockClear();
    builder.receive({ stats: true });
    return reply.mock.calls[0][0].stats;
  };
  return { builder, port, run, connect, posted, stats };
};

describe('wavetable builder', () => {
  it('builds the levels of a table and posts them to the store, their buffer transferred', () => {
    const { builder, port, run, connect } = setup();
    connect();
    builder.receive({ table: 'osc1', version: 1, frames: [sine, saw] });
    run();
    const [[message, transfer]] = port.postMessage.mock.calls;
    expect(message.table).toBe('osc1');
    expect(message.version).toBe(1);
    expect(message.levels.data).toEqual(buildLevels([sine, saw]).data);
    expect(transfer).toEqual([message.levels.data.buffer]);
  });

  it('builds the tables posted before the port of the store once it arrives', () => {
    const { builder, run, connect, posted } = setup();
    builder.receive({ table: 'osc1', version: 1, frames: [sine] });
    run();
    expect(posted()).toEqual([]);
    connect();
    run();
    expect(posted()).toEqual([expect.objectContaining({ table: 'osc1', version: 1 })]);
  });

  it('builds only the latest version of a table that waits, each table once', () => {
    const { builder, run, connect, posted } = setup();
    connect();
    builder.receive({ table: 'osc1', version: 1, frames: [sine] });
    builder.receive({ table: 'osc2', version: 1, frames: [saw] });
    builder.receive({ table: 'osc1', version: 2, frames: [saw] });
    run();
    expect(posted()).toEqual([
      expect.objectContaining({ table: 'osc1', version: 2 }),
      expect.objectContaining({ table: 'osc2', version: 1 }),
    ]);
  });

  it('passes the removal of a table on to the store', () => {
    const { builder, run, connect, posted } = setup();
    connect();
    builder.receive({ table: 'osc1', version: 1, frames: [sine] });
    builder.receive({ table: 'osc1', version: 2, remove: true });
    run();
    expect(posted()).toEqual([{ table: 'osc1', version: 2, remove: true }]);
  });

  it('reuses a buffer the store freed for a table of its size, keeps two at most', () => {
    const { builder, port, run, connect, posted } = setup();
    connect();
    const freed = (frames: Float32Array[]) => {
      const buffer = new ArrayBuffer(tableBytes(frames));
      port.onmessage?.({ data: { freed: buffer } });
      return buffer;
    };
    const small = freed([short]);
    const first = freed([saw]);
    freed([saw]);
    builder.receive({ table: 'osc1', version: 1, frames: [saw] });
    run();
    expect((posted()[0] as { levels: WavetableLevels }).levels.data.buffer).toBe(first);
    // the small one was dropped for the third: a table of its size gets a new buffer
    builder.receive({ table: 'osc2', version: 1, frames: [short] });
    run();
    expect((posted()[1] as { levels: WavetableLevels }).levels.data.buffer).not.toBe(small);
  });

  describe('in chunks (the store of the wasm core)', () => {
    // a store that asked for chunks of `size` samples; ack() hands the buffer of the last chunk back
    const chunked = (size: number) => {
      const context = setup();
      context.connect();
      context.port.onmessage?.({ data: { chunks: size } });
      const ack = () => {
        const [message] = context.port.postMessage.mock.lastCall as [{ chunk: ArrayBuffer }];
        context.port.onmessage?.({ data: { ack: message.chunk } });
      };
      return { ...context, ack };
    };

    it('sends the layout of a version, then its data in chunks, the next once the store acked the last', () => {
      const { builder, run, posted, ack, port } = chunked(5000);
      builder.receive({ table: 'osc1', version: 1, frames: [sine, saw] });
      run();
      const levels = buildLevels([sine, saw]);
      const { data, ...layout } = levels;
      expect(posted()).toEqual([
        { table: 'osc1', version: 1, begin: { ...layout, length: data.length } },
        expect.objectContaining({ table: 'osc1', version: 1, at: 0, length: 5000, last: false }),
      ]);
      // one chunk at a time
      run();
      expect(posted()).toHaveLength(2);
      const received = new Float32Array(data.length);
      for (;;) {
        const [message, transfer] = port.postMessage.mock.lastCall as [
          { chunk: ArrayBuffer; at: number; length: number; last: boolean },
          ArrayBuffer[]
        ];
        expect(transfer).toEqual([message.chunk]);
        received.set(new Float32Array(message.chunk, 0, message.length), message.at);
        if (message.last) break;
        ack();
      }
      expect(received).toEqual(data);
      // the chunk buffers are reused: one in all
      const buffers = new Set(
        posted().flatMap((message) =>
          'chunk' in (message as object) ? [(message as { chunk: ArrayBuffer }).chunk] : []
        )
      );
      expect(buffers.size).toBe(1);
    });

    it('sends the next table once the last chunk of a version is acked, and frees its levels', () => {
      const { builder, run, posted, ack, stats } = chunked(1 << 20);
      const transfer = jest.spyOn(
        ArrayBuffer.prototype as ArrayBuffer & { transfer: (length: number) => ArrayBuffer },
        'transfer'
      );
      builder.receive({ table: 'osc1', version: 1, frames: [saw] });
      builder.receive({ table: 'osc2', version: 1, frames: [short] });
      run();
      expect(transfer).not.toHaveBeenCalled();
      // one chunk holds the table: the second waits for its ack
      expect(posted().map((message) => (message as { table: string }).table)).toEqual(['osc1', 'osc1']);
      ack();
      run();
      expect(
        posted()
          .slice(2)
          .map((message) => (message as { table: string }).table)
      ).toEqual(['osc2', 'osc2']);
      // the levels of osc1 are freed at once (their buffer detached): nothing stays in the worker
      expect(transfer).toHaveBeenCalledTimes(1);
      expect(transfer).toHaveBeenCalledWith(0);
      const [freed] = transfer.mock.instances as unknown as (ArrayBuffer & { detached: boolean })[];
      expect(freed.detached).toBe(true);
      expect(stats()).toMatchObject({ pooled: 0, pool: 0 });
      transfer.mockRestore();
    });

    it('a version that comes during a transfer waits for it, a removal goes after it', () => {
      const { builder, run, posted, ack } = chunked(1 << 20);
      builder.receive({ table: 'osc1', version: 1, frames: [saw] });
      run();
      builder.receive({ table: 'osc1', version: 2, frames: [sine] });
      builder.receive({ table: 'osc2', version: 2, remove: true });
      run();
      expect(posted()).toHaveLength(2);
      ack();
      run();
      expect(posted().slice(2)).toEqual([
        expect.objectContaining({ table: 'osc1', version: 2, begin: expect.anything() }),
        expect.objectContaining({ table: 'osc1', version: 2, at: 0 }),
      ]);
      ack();
      run();
      expect(posted()[4]).toEqual({ table: 'osc2', version: 2, remove: true });
    });

    it('a new port of a store starts over: whole versions until it asks for chunks', () => {
      const { builder, run, posted, connect } = chunked(1000);
      builder.receive({ table: 'osc1', version: 1, frames: [saw] });
      run();
      connect();
      builder.receive({ table: 'osc1', version: 2, frames: [sine] });
      run();
      expect(posted().at(-1)).toEqual(
        expect.objectContaining({ table: 'osc1', version: 2, levels: expect.anything() })
      );
    });
  });

  describe('stats', () => {
    it('answers the tables waiting, before the port of the store too', () => {
      const { builder, stats } = setup();
      builder.receive({ table: 'osc1', version: 1, frames: [sine] });
      expect(stats()).toEqual({ pending: 1, pooled: 0, pool: 0, builds: 0, lastMs: 0, totalMs: 0, maxMs: 0 });
    });

    it('times the builds', () => {
      const { builder, run, connect, stats } = setup();
      const now = jest.spyOn(performance, 'now');
      // build 1: 10 ms, build 2: 30 ms
      [100, 110, 200, 230].forEach((ms) => now.mockReturnValueOnce(ms));
      connect();
      builder.receive({ table: 'osc1', version: 1, frames: [sine] });
      run();
      builder.receive({ table: 'osc1', version: 2, frames: [saw] });
      run();
      expect(stats()).toEqual({
        pending: 0,
        pooled: 0,
        pool: 0,
        builds: 2,
        lastMs: 30,
        totalMs: 40,
        maxMs: 30,
      });
      now.mockRestore();
    });

    it('answers the freed buffers kept and their bytes', () => {
      const { port, connect, stats } = setup();
      connect();
      const bytes = tableBytes([saw]);
      [1, 2, 3].forEach(() => port.onmessage?.({ data: { freed: new ArrayBuffer(bytes) } }));
      expect(stats()).toMatchObject({ pooled: 2, pool: 2 * bytes });
    });

    it("doesn't take a stats request for a table", () => {
      const { builder, run, connect, posted } = setup();
      connect();
      builder.receive({ stats: true });
      run();
      expect(posted()).toEqual([]);
    });
  });

  it('knows the bytes of a table', () => {
    expect(tableBytes([sine, saw])).toBe(buildLevels([sine, saw]).data.byteLength);
    expect(tableBytes([])).toBe(buildLevels([]).data.byteLength);
  });
});
