import { installWorkletScope, WorkletProcessorStub } from '../../../../test-utils/worklet-scope';
import { buildLevels } from './wavetable-mipmap';
import { STORE_PROCESSOR, VOICE_PARAMETERS, VOICE_PROCESSOR, VoiceParam } from './wavetable-osc-params';
import { STORE_CHUNK } from './wavetable-osc-wasm';

const RATE = 48000;
const processors = installWorkletScope(RATE);

// ENV 1 at full level, the gate ends the voice at once
const FLAT = { attack: 0, hold: 0, decay: 0, sustain: 1, release: 0 };

const sine = Array.from({ length: 2048 }, (_, n) => Math.sin((2 * Math.PI * n) / 2048));
const saw = Array.from({ length: 2048 }, (_, n) => n / 1024 - 1);

// a port of a MessageChannel: the worker posts to it, the store answers through it
const workerPort = () => ({
  onmessage: null as null | ((event: { data: unknown }) => void),
  postMessage: jest.fn(),
});

const params = (values: Partial<Record<VoiceParam, number>> = {}) =>
  Object.fromEntries(
    VOICE_PARAMETERS.map(({ name, defaultValue }) => [
      name,
      Float32Array.of(values[name as VoiceParam] ?? defaultValue),
    ])
  ) as Record<VoiceParam, Float32Array>;

const voice = (table: string, options: Partial<{ start: number; trace: boolean; mono: boolean }> = {}) =>
  new processors[VOICE_PROCESSOR]({
    processorOptions: {
      osc: [{ table, unison: 1, phase: 0.25, phaseRand: 0 }, null],
      start: 0,
      envelopes: [FLAT, FLAT, FLAT],
      routes: [],
      filter: null,
      phrase: 0,
      ...options,
      envStart: options.start ?? 0,
    },
  });

const render = (
  processor: WorkletProcessorStub,
  frame: number,
  values = params({ gain1: 1, frequency: 100 })
) => {
  Object.assign(globalThis, { currentFrame: frame });
  const outputs = [[new Float32Array(128), new Float32Array(128)]];
  const alive = processor.process([], outputs, values);
  return { alive, left: outputs[0][0], right: outputs[0][1] };
};

// the starts a voice posted (VoiceStartedMessage)
const startedMessages = (processor: WorkletProcessorStub) =>
  processor.port.postMessage.mock.calls.filter(([message]) => 'started' in message);

const stats = (store: WorkletProcessorStub) => {
  store.port.postMessage.mockClear();
  store.port.onmessage({ data: { stats: true } });
  return store.port.postMessage.mock.calls[0][0].stats;
};

// a version as the worker sends it to a store that asked for chunks: its layout, then chunks of `size` samples, each
// once the last was acked
const sendInChunks = (
  port: ReturnType<typeof workerPort>,
  table: string,
  version: number,
  frames: number[][],
  size = STORE_CHUNK
) => {
  const { data, ...layout } = buildLevels(frames);
  port.onmessage?.({ data: { table, version, begin: { ...layout, length: data.length } } });
  for (let at = 0; at < data.length; at += size) {
    const length = Math.min(size, data.length - at);
    const chunk = new ArrayBuffer(size * 4);
    new Float32Array(chunk, 0, length).set(data.subarray(at, at + length));
    port.onmessage?.({ data: { table, version, chunk, at, length, last: at + length >= data.length } });
    expect(port.postMessage).toHaveBeenLastCalledWith({ ack: chunk }, [chunk]);
  }
  return data;
};

describe('wavetable oscillator wasm worklet', () => {
  beforeAll(() => import('./wavetable-osc.worklet'));

  it('registers the store and the voice processor with the params of the voice', () => {
    expect(processors[STORE_PROCESSOR]).toBeDefined();
    expect(processors[VOICE_PROCESSOR].parameterDescriptors).toBe(VOICE_PARAMETERS);
  });

  it('stores a table posted whole to the store node and acknowledges it, voices play it', () => {
    const store = new processors[STORE_PROCESSOR]({});
    store.port.onmessage({
      data: { table: 'posted', version: 1, levels: buildLevels([sine.map((x) => x / 2)]) },
    });
    expect(store.port.postMessage).toHaveBeenCalledWith({ stored: 'posted', version: 1 });
    const { left, right, alive } = render(voice('posted'), 0);
    expect(alive).toBe(true);
    expect(left[0]).toBeCloseTo(0.5, 4);
    expect(right[0]).toBeCloseTo(0.5, 4);
  });

  it('asks the worker for chunks once it has its port, takes a version in chunks and acks each', () => {
    const store = new processors[STORE_PROCESSOR]({});
    const port = workerPort();
    store.port.onmessage({ data: { port } });
    expect(port.postMessage).toHaveBeenCalledWith({ chunks: STORE_CHUNK });
    // chunks of 1000 samples: the version is the latest once its last chunk is in
    const data = sendInChunks(port, 'chunked', 1, [saw], 1000);
    expect(data.length).toBeGreaterThan(10000);
    expect(store.port.postMessage).toHaveBeenCalledWith({ stored: 'chunked', version: 1 });
    const chunked = render(voice('chunked'), 0).left;
    const whole = new processors[STORE_PROCESSOR]({});
    whole.port.onmessage({ data: { table: 'whole', version: 1, levels: buildLevels([saw]) } });
    expect(chunked).toEqual(render(voice('whole'), 0).left);
  });

  it('refuses a version it has no memory for: the latest one plays on', () => {
    const store = new processors[STORE_PROCESSOR]({});
    const port = workerPort();
    store.port.onmessage({ data: { port } });
    sendInChunks(port, 'big', 1, [sine]);
    const before = render(voice('big'), 0).left;
    // 4 GB of samples: more than the memory of a wasm32 core
    const layout = {
      frames: 1,
      harmonics: [1, 0],
      lengths: [256, 1],
      offsets: [0, 259],
      length: 2 ** 30 - 1,
    };
    port.onmessage?.({ data: { table: 'big', version: 2, begin: layout } });
    const chunk = new ArrayBuffer(16);
    port.onmessage?.({ data: { table: 'big', version: 2, chunk, at: 0, length: 4, last: true } });
    expect(port.postMessage).toHaveBeenLastCalledWith({ ack: chunk }, [chunk]);
    expect(store.port.postMessage).toHaveBeenLastCalledWith({ refused: 'big', version: 2 });
    expect(render(voice('big'), 0).left).toEqual(before);
  });

  it('removes a table: new voices play the sine until it comes again', () => {
    const store = new processors[STORE_PROCESSOR]({});
    store.port.onmessage({ data: { table: 'removed', version: 1, levels: buildLevels([saw]) } });
    store.port.onmessage({ data: { table: 'removed', version: 2, remove: true } });
    const { left } = render(voice('removed'), 0);
    expect(left[0]).toBeCloseTo(1, 4);
    expect(left[64]).toBeCloseTo(Math.cos((2 * Math.PI * 100 * 64) / RATE), 4);
  });

  it('keeps a replaced version while a voice plays it, then frees it', () => {
    const store = new processors[STORE_PROCESSOR]({});
    const port = workerPort();
    store.port.onmessage({ data: { port } });
    const before = stats(store);
    const bytes = 4 * sendInChunks(port, 'held', 1, [saw]).length;
    const processor = voice('held');
    render(processor, 0);
    sendInChunks(port, 'held', 2, [sine]);
    expect(stats(store).versions - before.versions).toBe(2);
    // the voice crossfades into version 2 within 10 ms, then version 1 goes
    for (let frame = 128; frame < 1280; frame += 128) render(processor, frame);
    const after = stats(store);
    expect(after.versions - before.versions).toBe(1);
    expect(after.bytes - before.bytes).toBe(bytes);
  });

  it('starts at its start frame and ends where its gate drops, then tells the node', () => {
    const processor = voice('none', { start: 200 / RATE });
    expect(render(processor, 0).left.every((value) => value === 0)).toBe(true);
    expect(render(processor, 128).left[72]).toBeCloseTo(1, 4);
    const gate = Float32Array.from({ length: 128 }, (_, i) => (i < 10 ? 1 : 0));
    const { alive, left } = render(processor, 256, { ...params({ gain1: 1, frequency: 100 }), gate });
    expect(alive).toBe(false);
    expect(left.subarray(10).every((value) => value === 0)).toBe(true);
    expect(processor.port.postMessage).toHaveBeenCalledWith({ ended: true });
  });

  it('ends a voice that throws: it tells the node and gives its version back', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = new processors[STORE_PROCESSOR]({});
    store.port.onmessage({ data: { table: 'thrown', version: 1, levels: buildLevels([saw]) } });
    const processor = voice('thrown');
    render(processor, 0);
    store.port.onmessage({ data: { table: 'thrown', version: 2, levels: buildLevels([sine]) } });
    const held = stats(store).versions;
    const broken: Partial<Record<VoiceParam, Float32Array>> = params({ gain1: 1, frequency: 100 });
    broken.frequency = undefined;
    const { alive, left, right } = render(processor, 128, broken as Record<VoiceParam, Float32Array>);
    expect(alive).toBe(false);
    expect(left.every((value) => value === 0)).toBe(true);
    expect(right.every((value) => value === 0)).toBe(true);
    expect(processor.port.postMessage).toHaveBeenCalledWith({ ended: true });
    // version 1 is free once its voice ended
    expect(stats(store).versions).toBe(held - 1);
    expect(error).toHaveBeenCalledWith('A voice of the wavetable oscillator failed', expect.any(TypeError));
    error.mockRestore();
  });

  it('answers the counters of the store and the voices at the current frame', () => {
    const store = new processors[STORE_PROCESSOR]({});
    Object.assign(globalThis, { currentFrame: 640 });
    const before = stats(store);
    expect(before.frame).toBe(640);
    const levels = buildLevels([saw]);
    store.port.onmessage({ data: { table: 'counted', version: 1, levels } });
    const processor = voice('counted');
    render(processor, 0);
    render(processor, 128);
    const after = stats(store);
    expect(after.tables - before.tables).toBe(1);
    expect(after.bytes - before.bytes).toBe(levels.data.byteLength);
    expect(after.voices - before.voices).toBe(1);
    expect(after.mixSamples - before.mixSamples).toBe(128);
  });

  it('tells a start later than scheduled once: the fx and Poly follow it', () => {
    const processor = voice('none', { start: 100 / RATE });
    render(processor, 1280);
    render(processor, 1408);
    expect(startedMessages(processor)).toEqual([[{ started: 1280, scheduled: 100 }]]);
  });

  it('tells a start on time once for a voice of mono (it may start its envelopes again), for another none', () => {
    const mono = voice('none', { start: 200 / RATE, mono: true });
    const poly = voice('none', { start: 200 / RATE });
    for (const processor of [mono, poly]) {
      render(processor, 128);
      render(processor, 256);
    }
    expect(startedMessages(mono)).toEqual([[{ started: 200, scheduled: 200 }]]);
    expect(startedMessages(poly)).toEqual([]);
  });

  it('takes the routes of a playing note from its port: the amounts glide', () => {
    const processor = voice('none');
    expect(render(processor, 0).left[0]).toBeCloseTo(1, 4);
    processor.port.onmessage({ data: { routes: [{ env: 1, param: 'gain1', amount: -1, min: 0, max: 1 }] } });
    [128, 256, 384, 512].forEach((frame) => render(processor, frame));
    expect(render(processor, 640).left.every((value) => Math.abs(value) < 1e-6)).toBe(true);
  });

  it('takes the filter of a playing note from its port', () => {
    const processor = voice('none');
    const open = render(processor, 0, params({ gain1: 1, frequency: 4000 })).left;
    processor.port.onmessage({ data: { filter: { type: 'lowpass', cutoff: 200, resonance: 0, gain: 0 } } });
    const loudest = (data: Float32Array) => Math.max(...data.map(Math.abs));
    expect(loudest(render(processor, 128, params({ gain1: 1, frequency: 4000 })).left)).toBeLessThan(
      loudest(open) / 10
    );
  });

  it('renders into one channel when the node has one', () => {
    const outputs = [[new Float32Array(128)]];
    Object.assign(globalThis, { currentFrame: 0 });
    expect(voice('none').process([], outputs, params({ gain1: 1 }))).toBe(true);
    expect(outputs[0][0][0]).toBeCloseTo(1, 4);
  });
});
