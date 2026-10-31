import { createSynth } from '../../../../test-utils/models';
import { BLOCK, createVoiceScope } from '../../../../test-utils/voice-dsp';
import { wasmCore } from '../../../../test-utils/wasm';
import { WorkerStub } from '../../../../test-utils/worker-stub';
import { createTableBuilder } from './wavetable-builder';
import { createLevels, FRAME_GUARD, levelHarmonics, levelLength } from './wavetable-levels';
import { MAX_FRAMES, MAX_HARMONICS, tableBytes } from './wavetable-mipmap';
import { CROSSFADE, VoiceOscOptions } from './voice-options';
import {
  createOscScope,
  createStoreReceiver,
  createTableStoreWasm,
  OscExports,
  STORE_CHUNK,
} from './wavetable-osc-wasm';

// the memory of the wavetable oscillator worked out (it replaces the memory checks of the browser suite but the
// footprint of the heavy patch, S5): the bytes of a table, the versions the store of the core holds while voices
// play a replaced one, the memory of the core, the mix tables of the voices

const RATE = 48000;
const MB = 1e6;

const saw = (scale: number) =>
  Float32Array.from({ length: 2048 }, (_, n) => {
    let sum = 0;
    for (let k = 1; k <= 1023; k++) sum += Math.sin((2 * Math.PI * k * n) / 2048) / k;
    return scale * sum;
  });
const SAW = saw(1);
// a table of 3 frames: the same layout per frame as a table of 256 (every frame of 2048 samples has 1023
// harmonics)
const frames = (version: number) => [SAW, SAW.map((v) => (v * version) / 8), SAW.map((v) => -v)];

const OSCS: VoiceOscOptions[] = [
  { table: 'a', unison: 8, phase: 0.5, phaseRand: 1 },
  { table: 'b', unison: 8, phase: 0.5, phaseRand: 1 },
];
const NOTE = { frequency: 220, position1: 0.5, position2: 0.5, spread1: 25, spread2: 35 };

describe('the memory of the wavetable oscillator', () => {
  it('a table of 256 frames of 2048 samples takes 66,683,904 bytes: 32 levels a frame', () => {
    const lengths = levelHarmonics(MAX_HARMONICS).map(levelLength);
    expect(lengths).toHaveLength(32);
    // 12 levels of 4096 samples, 3 of 2048, 3 of 1024, 13 of 512 and the silent one of 1
    const count = (length: number) => lengths.filter((value) => value === length).length;
    expect([4096, 2048, 1024, 512, 1].map(count)).toEqual([12, 3, 3, 13, 1]);
    const frameBytes = lengths.reduce((sum, length) => sum + (length + FRAME_GUARD) * 4, 0);
    expect(frameBytes).toBe(260484);
    expect(createLevels(MAX_FRAMES, MAX_HARMONICS).data.byteLength).toBe(MAX_FRAMES * frameBytes);
    expect(MAX_FRAMES * frameBytes).toBe(66683904);
    expect(tableBytes(frames(1))).toBe(3 * frameBytes);
  });

  it('the first switch of 2 tables of 256 frames adds 133.4 MB, within the 150 MB the browser suite allowed', () => {
    // the store holds both versions of each table during the crossfade, its slots keep the old ones
    const added = 2 * createLevels(MAX_FRAMES, MAX_HARMONICS).data.byteLength;
    expect(added / MB).toBeCloseTo(133.37, 2);
    expect(added).toBeLessThan(150 * MB);
  });

  it('a version that arrives during a crossfade waits for it: 3 versions of the table meanwhile', () => {
    const { scope: core, store, setTable } = createWasmTables();
    setTable('a', 1);
    setTable('b', 1);
    const scope = createVoiceScope({ rate: RATE, store, scope: core });
    scope.add(OSCS, NOTE);
    Array.from({ length: 4 }, scope.block);
    setTable('a', 2);
    scope.block();
    setTable('a', 3);
    expect(store.stats().versions).toBe(4);
    Array.from({ length: 20 }, scope.block);
    expect(store.stats()).toMatchObject({ tables: 2, versions: 2 });
  });

  it.each([
    [48000, 48],
    [96000, 48],
  ])(
    'at %i Hz the mixes of the heavy chord take %i tables of 4096 samples, a chord after it reuses them',
    (rate, mixes) => {
      const { scope: core, store, setTable } = createWasmTables();
      setTable('a', 1);
      setTable('b', 1);
      const scope = createVoiceScope({ rate, store, scope: core });
      const notes = Array.from({ length: 12 }, (_, i) => 110 * 2 ** (i / 12));
      // of its 192 unison voices those in a crossfade of their levels, a mix as long as their level each (4096 for
      // these notes; as long as a native table they took 3,148,032 bytes at 48 kHz, 12,585,216 at 96)
      const bytes = mixes * (4096 + FRAME_GUARD) * 4;
      // every mix built, then the notes end and the next chord plays
      const blocks = 20;
      for (let cycle = 0; cycle < 3; cycle++) {
        const voices = notes.map((frequency) => scope.add(OSCS, { ...NOTE, frequency }));
        Array.from({ length: blocks }, scope.block);
        voices.forEach((voice) => (voice.params.gate = 0));
        scope.block();
        expect(scope.alive()).toBe(0);
      }
      expect(scope.shared.stats()).toMatchObject({ mixes, mixBytes: bytes });
    }
  );

  it('the mixes of a chord of shorter levels take the tables of one before it: none allocated', () => {
    // the heavy chord, then two octaves up: levels of 1024 and 2048 samples, its mixes in the tables of 4096
    const chord = (base: number) => Array.from({ length: 12 }, (_, i) => base * 2 ** (i / 12));
    const play = (chords: number[][]) => {
      const { scope: core, store, setTable } = createWasmTables();
      setTable('a', 1);
      setTable('b', 1);
      const scope = createVoiceScope({ rate: 48000, store, scope: core });
      chords.forEach((notes) => {
        const voices = notes.map((frequency) => scope.add(OSCS, { ...NOTE, frequency }));
        Array.from({ length: 20 }, scope.block);
        voices.forEach((voice) => (voice.params.gate = 0));
        scope.block();
      });
      return scope.shared.stats();
    };
    const low = play([chord(110)]).mixes;
    const high = play([chord(440)]).mixes;
    expect(high).toBeGreaterThan(0);
    expect(play([chord(110), chord(440)])).toMatchObject({
      mixes: Math.max(low, high),
      mixBytes: Math.max(low, high) * (4096 + FRAME_GUARD) * 4,
    });
  });

  it('an oscillator that is off sends its table too: a note right after it is switched on plays it (F6)', async () => {
    // its levels are built and held like those of an oscillator on: 66.7 MB for a table of 256 frames
    const { osc1, osc2 } = createSynth();
    await new Promise((resolve) => setTimeout(resolve));
    const [worker] = WorkerStub.created;
    worker.postMessage.mockClear();
    expect(osc2[0].$active.value).toBe(false);
    osc2[1].setWaveTable([
      [0, 1, 0, -1],
      [1, 0, -1, 0],
    ]);
    const tables = worker.postMessage.mock.calls.map(([message]) => (message as { table?: string }).table);
    expect(tables).toContain(osc2[0].id);
    expect(tables).not.toContain(osc1[0].id);
  });
});

// the store of the wasm core: the worker's builder in chunks and the store of the worklet (createStoreReceiver) on
// the two ends of their channel, a fresh instance of the core each (its memory is measured)
const createWasmTables = () => {
  const queue: (() => void)[] = [];
  const reply = jest.fn();
  const builder = createTableBuilder((run) => queue.push(run), reply);
  const scope = createOscScope(wasmCore<OscExports>('wavetable-osc'));
  const store = createTableStoreWasm(scope);
  const chunks: number[] = [];
  type End = {
    onmessage: null | ((event: { data: unknown }) => void);
    postMessage: (message: unknown) => void;
  };
  const workerEnd: End = {
    onmessage: null,
    postMessage: (message) => storeEnd.onmessage?.({ data: message }),
  };
  const storeEnd: End = {
    onmessage: null,
    postMessage: (message) => {
      if ((message as { ack?: ArrayBuffer }).ack) chunks.push(1);
      workerEnd.onmessage?.({ data: message });
    },
  };
  builder.receive({ port: workerEnd as unknown as MessagePort });
  const stored: unknown[] = [];
  const receive = createStoreReceiver(
    store,
    (message) => stored.push(message),
    () => undefined
  );
  receive({ data: { port: storeEnd } } as MessageEvent);
  // the messages of a worker straight to the store (its port)
  const post = (message: unknown) => storeEnd.onmessage?.({ data: message });
  const setTable = (table: string, version: number) => {
    builder.receive({ table, version, frames: frames(version) });
    // the chunks go through the stub ports at once, each after the ack of the last
    while (queue.length) queue.splice(0).forEach((run) => run());
  };
  const pool = () => {
    reply.mockClear();
    builder.receive({ stats: true });
    return reply.mock.calls[0][0].stats as { pooled: number; pool: number };
  };
  const memory = () => scope.exports.memory.buffer.byteLength;
  return { scope, store, setTable, pool, memory, stored, chunks, post, receive };
};

// the layout of a version of `length` samples (one frame, one level: the store doesn't read it)
const layout = (length: number) => ({ frames: 1, harmonics: [1], lengths: [8], offsets: [0], length });
const MIB = 2 ** 20;
// the samples of a frame of 2048 samples (1023 harmonics: the layout of every frame of a table of 256)
const FRAME_SAMPLES = tableBytes([SAW]) / 4;
const ZEROS = new Float32Array(STORE_CHUNK);
// a version of `length` samples through the store, in chunks, as the worker sends it: committed
const sendVersion = (
  store: ReturnType<typeof createTableStoreWasm>,
  table: string,
  version: number,
  length: number
) => {
  const slot = store.begin(table, version, layout(length));
  if (slot === null) return false;
  for (let at = 0; at < length; at += STORE_CHUNK)
    store.write(slot, at, ZEROS.subarray(0, Math.min(STORE_CHUNK, length - at)));
  return store.commit(slot);
};

describe('the memory of the wasm store', () => {
  it('a version arrives in chunks of 1 MB, each acked, the store holds it in the memory of its core', () => {
    const { store, setTable, stored, chunks, memory } = createWasmTables();
    const before = memory();
    setTable('a', 1);
    const bytes = tableBytes(frames(1));
    expect(chunks).toHaveLength(Math.ceil(bytes / 4 / STORE_CHUNK));
    expect(stored).toEqual([{ stored: 'a', version: 1 }]);
    expect(store.stats()).toEqual({ tables: 1, versions: 1, bytes });
    expect(memory() - before).toBeGreaterThanOrEqual(bytes);
  });

  it('a new version of both tables under a note: 2 versions a table during the crossfade, then 1', () => {
    const { scope, store, setTable } = createWasmTables();
    const bytes = tableBytes(frames(1));
    setTable('a', 1);
    setTable('b', 1);
    const voices = createVoiceScope({ rate: RATE, scope, store });
    const voice = voices.add(OSCS, NOTE);
    Array.from({ length: 10 }, voices.block);
    setTable('a', 2);
    setTable('b', 2);
    expect(store.stats()).toEqual({ tables: 2, versions: 4, bytes: 4 * bytes });
    const crossfade = Math.ceil((CROSSFADE * RATE) / BLOCK);
    Array.from({ length: crossfade }, voices.block);
    expect(store.stats()).toEqual({ tables: 2, versions: 2, bytes: 2 * bytes });
    voice.params.gate = 0;
    voices.block();
    expect(voices.alive()).toBe(0);
  });

  it('later versions reuse the slots of the freed ones: the memory of the core stops growing', () => {
    const { scope, store, setTable, pool, memory } = createWasmTables();
    const bytes = tableBytes(frames(1));
    setTable('a', 1);
    setTable('b', 1);
    const voices = createVoiceScope({ rate: RATE, scope, store });
    voices.add(OSCS, NOTE);
    const sizes: number[] = [];
    for (let version = 2; version <= 8; version++) {
      setTable('a', version);
      setTable('b', version);
      Array.from({ length: 8 }, voices.block);
      sizes.push(memory());
      // the worker keeps no levels: the store of the core gives no buffer back (it frees them after the last chunk)
      expect(pool()).toMatchObject({ pooled: 0, pool: 0 });
    }
    // the store holds 2 versions, its pool the 2 freed ones: from the second switch on nothing is allocated
    expect(new Set(sizes.slice(1)).size).toBe(1);
    expect(store.stats()).toMatchObject({ tables: 2, versions: 2, bytes: 2 * bytes });
  });

  it('a table that grows a frame at a time from 1 to 256 (waves added in the editor): within 245 MiB', () => {
    const { store, memory } = createWasmTables();
    for (let frames = 1; frames <= MAX_FRAMES; frames++)
      expect(sendVersion(store, 'a', frames, frames * FRAME_SAMPLES)).toBe(true);
    // the latest (63.6 MiB) and the one before it while the next comes (both play until it is complete), and what
    // the allocator can't join: every version is larger than the space of those freed before it, and dlmalloc
    // grows the memory by a whole request its free top can't hold (239 MiB; 367 when the pool held buffers of
    // their exact size only; a model of best fit without the waste of the top gives 190: no allocator that
    // doesn't move the data gets the two versions of 127 MiB alone)
    expect(memory()).toBeLessThanOrEqual(245 * MIB);
    expect(store.stats()).toMatchObject({ tables: 1, versions: 1, bytes: MAX_FRAMES * FRAME_SAMPLES * 4 });
  });

  it('two sizes in turn, 20 versions: the memory stops growing after the first switches', () => {
    const { store, memory } = createWasmTables();
    const sizes: number[] = [];
    for (let version = 1; version <= 20; version++) {
      expect(sendVersion(store, 'a', version, (version % 2 ? 100 : 60) * FRAME_SAMPLES)).toBe(true);
      sizes.push(memory());
    }
    expect(new Set(sizes.slice(2)).size).toBe(1);
  });

  it('a version whose last chunk has not come is refused: never the latest', () => {
    const { store, post, stored } = createWasmTables();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(sendVersion(store, 'a', 1, STORE_CHUNK)).toBe(true);
    const chunk = () => new Float32Array(STORE_CHUNK).buffer;
    post({ table: 'a', version: 2, begin: layout(3 * STORE_CHUNK) });
    post({ table: 'a', version: 2, chunk: chunk(), at: 0, length: STORE_CHUNK, last: false });
    post({ table: 'a', version: 2, chunk: chunk(), at: STORE_CHUNK, length: STORE_CHUNK, last: true });
    expect(stored).toEqual([{ refused: 'a', version: 2 }]);
    expect(store.stats()).toMatchObject({ tables: 1, versions: 1, bytes: 4 * STORE_CHUNK });
  });

  it('a chunk out of its place (not where the last one ended, or past the version) is refused, the next version arrives', () => {
    const { store, post, stored, setTable } = createWasmTables();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const chunk = () => new Float32Array(STORE_CHUNK).buffer;
    post({ table: 'a', version: 1, begin: layout(2 * STORE_CHUNK) });
    post({ table: 'a', version: 1, chunk: chunk(), at: 5, length: STORE_CHUNK, last: false });
    post({ table: 'a', version: 1, chunk: chunk(), at: STORE_CHUNK, length: STORE_CHUNK, last: true });
    post({ table: 'b', version: 1, begin: layout(STORE_CHUNK) });
    post({ table: 'b', version: 1, chunk: chunk(), at: 0, length: STORE_CHUNK, last: false });
    post({ table: 'b', version: 1, chunk: chunk(), at: STORE_CHUNK, length: STORE_CHUNK, last: true });
    expect(stored).toEqual([
      { refused: 'a', version: 1 },
      { refused: 'b', version: 1 },
    ]);
    expect(store.stats()).toMatchObject({ tables: 0, versions: 0 });
    setTable('a', 2);
    expect(stored.at(-1)).toEqual({ stored: 'a', version: 2 });
  });

  it('the bytes of a version freed reach the listener of the store, once; none while a voice plays it', () => {
    const { scope, store, setTable } = createWasmTables();
    const freed = jest.fn();
    store.listen(freed);
    setTable('a', 1);
    expect(freed).not.toHaveBeenCalled();
    // version 1 is let go at the commit of 2
    setTable('a', 2);
    expect(freed).toHaveBeenCalledTimes(1);
    expect(freed.mock.calls[0][0]).toBeGreaterThanOrEqual(tableBytes(frames(1)));
    store.drain();
    expect(freed).toHaveBeenCalledTimes(1);
    // a voice holds version 2 until its crossfade into 3 is over: freed in a block of the voice
    const voices = createVoiceScope({ rate: RATE, scope, store });
    voices.add([OSCS[0], null], NOTE);
    Array.from({ length: 4 }, voices.block);
    setTable('a', 3);
    expect(freed).toHaveBeenCalledTimes(1);
    Array.from({ length: Math.ceil((CROSSFADE * RATE) / BLOCK) + 2 }, voices.block);
    expect(freed).toHaveBeenCalledTimes(2);
  });

  it('a version its worker stopped sending gives its buffer back: 10 of them in a row allocate once', () => {
    const { store, memory } = createWasmTables();
    const sizes: number[] = [];
    for (let i = 0; i < 10; i++) {
      const slot = store.begin('a', i + 1, layout(4 * STORE_CHUNK)) as number;
      expect(slot).not.toBeNull();
      store.abort(slot);
      sizes.push(memory());
    }
    expect(new Set(sizes).size).toBe(1);
    expect(store.stats()).toMatchObject({ tables: 0, versions: 0 });
  });

  it('a version of a table that begins while an older one is still coming aborts it', () => {
    const { store, memory } = createWasmTables();
    store.begin('a', 1, layout(4 * STORE_CHUNK));
    const size = memory();
    const slot = store.begin('a', 2, layout(4 * STORE_CHUNK)) as number;
    // (the buffer of the first one taken again)
    expect(memory()).toBe(size);
    store.write(slot, 0, new Float32Array(4 * STORE_CHUNK).fill(0.5));
    expect(store.commit(slot)).toBe(true);
    expect(store.stats()).toMatchObject({ tables: 1, versions: 1 });
  });

  it('a chunk that fails is acked all the same: its version is refused, the next table arrives', () => {
    const { store, setTable, stored, chunks } = createWasmTables();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(store, 'write').mockImplementationOnce(() => {
      throw new WebAssembly.RuntimeError('unreachable');
    });
    setTable('a', 1);
    const count = Math.ceil(tableBytes(frames(1)) / 4 / STORE_CHUNK);
    expect(chunks).toHaveLength(count);
    expect(stored).toEqual([{ refused: 'a', version: 1 }]);
    expect(store.stats()).toMatchObject({ tables: 0, versions: 0 });
    setTable('b', 1);
    expect(stored).toEqual([
      { refused: 'a', version: 1 },
      { stored: 'b', version: 1 },
    ]);
    expect(store.stats()).toMatchObject({ tables: 1, versions: 1 });
  });

  it('an abort from the worker drops the slot of its version', () => {
    const { store, post, memory } = createWasmTables();
    post({ table: 'a', version: 1, begin: layout(4 * STORE_CHUNK) });
    const size = memory();
    post({ table: 'a', version: 1, abort: true });
    // the buffer is free: another table of its size takes it
    expect(store.begin('b', 1, layout(4 * STORE_CHUNK))).not.toBeNull();
    expect(memory()).toBe(size);
  });

  it('the port of a new worker aborts what the old one was sending; what still comes to the old receiver is dropped', () => {
    const { store, post, memory, stored } = createWasmTables();
    post({ table: 'a', version: 1, begin: layout(STORE_CHUNK) });
    // a retry: a new store processor (a receiver of its own on the same store) and a new worker
    const replies: unknown[] = [];
    const next = createStoreReceiver(
      store,
      (message) => replies.push(message),
      () => undefined
    );
    const port = { onmessage: null, postMessage: jest.fn() };
    next({ data: { port } } as unknown as MessageEvent);
    const size = memory();
    // the new worker's version takes the slot and the buffer the old one had
    const slot = store.begin('b', 1, layout(STORE_CHUNK));
    expect(slot).not.toBeNull();
    expect(memory()).toBe(size);
    // a late chunk of the old worker writes nothing into it
    const chunk = new Float32Array(STORE_CHUNK).fill(1);
    post({ table: 'a', version: 1, chunk: chunk.buffer, at: 0, length: STORE_CHUNK, last: true });
    expect(stored).toEqual([]);
    expect(store.stats()).toMatchObject({ tables: 0, versions: 0 });
  });
});
