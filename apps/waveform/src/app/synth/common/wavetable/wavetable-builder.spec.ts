import { createTableBuilder } from './wavetable-builder';
import { buildLevels, tableBytes } from './wavetable-mipmap';
import type { WavetableLevels } from './wavetable-levels';

const sine = Float32Array.from({ length: 2048 }, (_, n) => Math.sin((2 * Math.PI * n) / 2048));
const saw = Float32Array.from({ length: 2048 }, (_, n) => n / 1024 - 1);
const short = Float32Array.from({ length: 64 }, (_, n) => Math.sin((2 * Math.PI * n) / 64));

// the builds run when the test says so (setTimeout in the worker)
const setup = () => {
  const queue: (() => void)[] = [];
  const builder = createTableBuilder((run) => queue.push(run));
  const port = { onmessage: null as null | ((event: { data: unknown }) => void), postMessage: jest.fn() };
  const run = () => queue.splice(0).forEach((task) => task());
  const connect = () => builder.receive({ port: port as unknown as MessagePort });
  const posted = () => port.postMessage.mock.calls.map(([message]) => message);
  return { builder, port, run, connect, posted };
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

  it('knows the bytes of a table', () => {
    expect(tableBytes([sine, saw])).toBe(buildLevels([sine, saw]).data.byteLength);
    expect(tableBytes([])).toBe(buildLevels([]).data.byteLength);
  });
});
