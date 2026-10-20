import { createSynth } from '../../../../test-utils/models';
import { BLOCK, createVoiceScope } from '../../../../test-utils/voice-dsp';
import { wasmCore } from '../../../../test-utils/wasm';
import { WorkerStub } from '../../../../test-utils/worker-stub';
import { createTableBuilder } from './wavetable-builder';
import { FRAME_GUARD } from './wavetable-levels';
import {
  createLevels,
  levelHarmonics,
  levelLength,
  MAX_FRAMES,
  MAX_HARMONICS,
  tableBytes,
} from './wavetable-mipmap';
import { CROSSFADE, nativeTableLength, VoiceOscOptions } from './voice-options';
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
    [48000, 3148032],
    [96000, 12585216],
  ])('at %i Hz the mixes of the heavy chord take %i bytes, a chord after it reuses them', (rate, bytes) => {
    const { scope: core, store, setTable } = createWasmTables();
    setTable('a', 1);
    setTable('b', 1);
    const scope = createVoiceScope({ rate, store, scope: core });
    const notes = Array.from({ length: 12 }, (_, i) => 110 * 2 ** (i / 12));
    // 192 unison voices, a mix of the length of a native table each
    expect(192 * (nativeTableLength(rate) + FRAME_GUARD) * 4).toBe(bytes);
    // every mix built (one a block at 96 kHz, F1), then the notes end and the next chord plays
    const blocks = rate > 48000 ? 200 : 20;
    for (let cycle = 0; cycle < 3; cycle++) {
      const voices = notes.map((frequency) => scope.add(OSCS, { ...NOTE, frequency }));
      Array.from({ length: blocks }, scope.block);
      voices.forEach((voice) => (voice.params.gate = 0));
      scope.block();
      expect(scope.alive()).toBe(0);
    }
    expect(scope.shared.stats()).toMatchObject({ mixes: 192, mixBytes: bytes });
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
  return { scope, store, setTable, pool, memory, stored, chunks };
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
      // the worker keeps the levels it built (two at most) for the next build of their size
      expect(pool().pool).toBeLessThanOrEqual(2 * bytes);
    }
    // the store holds 2 versions, its pool the 2 freed ones: from the second switch on nothing is allocated
    expect(new Set(sizes.slice(1)).size).toBe(1);
    expect(store.stats()).toMatchObject({ tables: 2, versions: 2, bytes: 2 * bytes });
  });
});
