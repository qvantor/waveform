import { installWorkletScope, WorkletProcessorStub } from '../../../../test-utils/worklet-scope';
import { buildLevels } from './wavetable-mipmap';
import { STORE_PROCESSOR, VOICES_PROCESSOR, VoiceParam } from './wavetable-osc-params';
import { STORE_CHUNK } from './wavetable-osc-wasm';
import type { VoiceEvent, VoiceOptions } from './voice-options';

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

// a voices node playing one note of `table` (at 100 Hz, gain 1 unless `params` say otherwise), its events
// before its first block
const voice = (
  table: string,
  options: Partial<VoiceOptions> = {},
  params: Partial<Record<VoiceParam, number>> = {},
  events: VoiceEvent[] = []
) =>
  new processors[VOICES_PROCESSOR]({
    processorOptions: {
      events: [
        {
          kind: 'on',
          voice: 1,
          options: {
            osc: [{ table, unison: 1, phase: 0.25, phaseRand: 0 }, null],
            start: 0,
            envelopes: [FLAT, FLAT, FLAT],
            routes: [],
            filter: null,
            phrase: 0,
            ...options,
            envStart: options.start ?? 0,
          },
          params: { gain1: 1, frequency: 100, ...params },
        },
        ...events,
      ],
    },
  });

const render = (processor: WorkletProcessorStub, frame: number) => {
  Object.assign(globalThis, { currentFrame: frame });
  const outputs = [[new Float32Array(128), new Float32Array(128)]];
  const alive = processor.process([], outputs, {});
  return { alive, left: outputs[0][0], right: outputs[0][1] };
};

// what a voices node told the main thread
const reports = (processor: WorkletProcessorStub) =>
  processor.port.postMessage.mock.calls.map(([message]) => message);

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

// (the nodes of a test stop at its end: their voices give their versions back to the store of the scope)
const nodes: WorkletProcessorStub[] = [];
const track = (processor: WorkletProcessorStub) => {
  nodes.push(processor);
  return processor;
};
afterEach(() => nodes.splice(0).forEach((processor) => processor.port.onmessage({ data: { stop: true } })));

describe('wavetable oscillator wasm worklet', () => {
  beforeAll(() => import('./wavetable-osc.worklet'));

  it('registers the store and the voices processor', () => {
    expect(processors[STORE_PROCESSOR]).toBeDefined();
    expect(processors[VOICES_PROCESSOR]).toBeDefined();
  });

  it('stores a table posted whole to the store node and acknowledges it, voices play it', () => {
    const store = new processors[STORE_PROCESSOR]({});
    store.port.onmessage({
      data: { table: 'posted', version: 1, levels: buildLevels([sine.map((x) => x / 2)]) },
    });
    expect(store.port.postMessage).toHaveBeenCalledWith({ stored: 'posted', version: 1 });
    const { left, right, alive } = render(track(voice('posted')), 0);
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
    const chunked = render(track(voice('chunked')), 0).left;
    const whole = new processors[STORE_PROCESSOR]({});
    whole.port.onmessage({ data: { table: 'whole', version: 1, levels: buildLevels([saw]) } });
    expect(chunked).toEqual(render(track(voice('whole')), 0).left);
  });

  it('refuses a version it has no memory for: the latest one plays on', () => {
    const store = new processors[STORE_PROCESSOR]({});
    const port = workerPort();
    store.port.onmessage({ data: { port } });
    sendInChunks(port, 'big', 1, [sine]);
    const before = render(track(voice('big')), 0).left;
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
    expect(render(track(voice('big')), 0).left).toEqual(before);
  });

  it('removes a table: new voices play the sine until it comes again', () => {
    const store = new processors[STORE_PROCESSOR]({});
    store.port.onmessage({ data: { table: 'removed', version: 1, levels: buildLevels([saw]) } });
    store.port.onmessage({ data: { table: 'removed', version: 2, remove: true } });
    const { left } = render(track(voice('removed')), 0);
    expect(left[0]).toBeCloseTo(1, 4);
    expect(left[64]).toBeCloseTo(Math.cos((2 * Math.PI * 100 * 64) / RATE), 4);
  });

  it('keeps a replaced version while a voice plays it, then frees it', () => {
    const store = new processors[STORE_PROCESSOR]({});
    const port = workerPort();
    store.port.onmessage({ data: { port } });
    const before = stats(store);
    const bytes = 4 * sendInChunks(port, 'held', 1, [saw]).length;
    const processor = track(voice('held'));
    render(processor, 0);
    sendInChunks(port, 'held', 2, [sine]);
    expect(stats(store).versions - before.versions).toBe(2);
    // the voice crossfades into version 2 within 10 ms, then version 1 goes
    for (let frame = 128; frame < 1280; frame += 128) render(processor, frame);
    const after = stats(store);
    expect(after.versions - before.versions).toBe(1);
    expect(after.bytes - before.bytes).toBe(bytes);
  });

  it('starts at its start frame and ends where its gate drops, then tells the main thread', () => {
    const gate: VoiceEvent = { kind: 'set', voice: 1, param: 'gate', value: 0, time: 266 / RATE };
    const processor = track(voice('none', { start: 200 / RATE }, {}, [gate]));
    expect(render(processor, 0).left.every((value) => value === 0)).toBe(true);
    expect(render(processor, 128).left[72]).toBeCloseTo(1, 4);
    const { alive, left } = render(processor, 256);
    // the node plays on, its voice ended
    expect(alive).toBe(true);
    expect(left.subarray(10).every((value) => value === 0)).toBe(true);
    expect(reports(processor)).toEqual([{ ended: [1] }]);
  });

  it('ends a voice whose note on traps: it tells the main thread, its version goes back', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = new processors[STORE_PROCESSOR]({});
    store.port.onmessage({ data: { table: 'thrown', version: 1, levels: buildLevels([saw]) } });
    const held = stats(store).versions;
    // more routes than the command buffer holds: the core reads past it
    const routes = Array.from({ length: 1000 }, () => ({
      env: 1,
      param: 'gain1',
      amount: 1,
      min: 0,
      max: 1,
    }));
    const processor = track(voice('thrown', { routes }));
    const { left, right } = render(processor, 0);
    expect(left.every((value) => value === 0)).toBe(true);
    expect(right.every((value) => value === 0)).toBe(true);
    expect(reports(processor)).toEqual([{ ended: [1] }]);
    store.port.onmessage({ data: { table: 'thrown', version: 2, levels: buildLevels([sine]) } });
    // version 1 is free: no voice holds it
    expect(stats(store).versions).toBe(held);
    expect(error).toHaveBeenCalledWith('A voice of the wavetable oscillator failed', expect.any(Error));
    error.mockRestore();
  });

  it('answers the counters of the store and the voices at the current frame', () => {
    const store = new processors[STORE_PROCESSOR]({});
    Object.assign(globalThis, { currentFrame: 640 });
    const before = stats(store);
    expect(before.frame).toBe(640);
    const levels = buildLevels([saw]);
    store.port.onmessage({ data: { table: 'counted', version: 1, levels } });
    const processor = track(voice('counted'));
    render(processor, 0);
    render(processor, 128);
    const after = stats(store);
    expect(after.tables - before.tables).toBe(1);
    expect(after.bytes - before.bytes).toBe(levels.data.byteLength);
    expect(after.voices - before.voices).toBe(1);
    expect(after.mixSamples - before.mixSamples).toBe(128);
  });

  it('tells a start later than scheduled once: the fx and Poly follow it', () => {
    const processor = track(voice('none', { start: 100 / RATE }));
    render(processor, 1280);
    render(processor, 1408);
    expect(reports(processor)).toEqual([{ started: [[1, 1280, 100]] }]);
  });

  it('tells a start on time once for a voice of mono (it may start its envelopes again), for another none', () => {
    const mono = track(voice('none', { start: 200 / RATE, mono: true }));
    const poly = track(voice('none', { start: 200 / RATE }));
    for (const processor of [mono, poly]) {
      render(processor, 128);
      render(processor, 256);
    }
    expect(reports(mono)).toEqual([{ started: [[1, 200, 200]] }]);
    expect(reports(poly)).toEqual([]);
  });

  it('takes the routes of a playing note from its port: the amounts glide', () => {
    const processor = track(voice('none'));
    expect(render(processor, 0).left[0]).toBeCloseTo(1, 4);
    const routes = [{ env: 1, param: 'gain1', amount: -1, min: 0, max: 1 }];
    processor.port.onmessage({ data: { events: [{ kind: 'routes', voices: [1], routes }] } });
    [128, 256, 384, 512].forEach((frame) => render(processor, frame));
    expect(render(processor, 640).left.every((value) => Math.abs(value) < 1e-6)).toBe(true);
  });

  it('takes the filter of a playing note from its port', () => {
    const open = render(track(voice('none', {}, { frequency: 4000 })), 0).left;
    const processor = track(voice('none', {}, { frequency: 4000 }));
    render(processor, 0);
    const filter = { type: 'lowpass', cutoff: 200, resonance: 0, gain: 0 };
    processor.port.onmessage({ data: { events: [{ kind: 'filter', voices: [1], filter }] } });
    const loudest = (data: Float32Array) => Math.max(...data.map(Math.abs));
    expect(loudest(render(processor, 128).left)).toBeLessThan(loudest(open) / 10);
  });

  it('renders into one channel when the node has one', () => {
    const outputs = [[new Float32Array(128)]];
    Object.assign(globalThis, { currentFrame: 0 });
    expect(track(voice('none')).process([], outputs, {})).toBe(true);
    expect(outputs[0][0][0]).toBeCloseTo(1, 4);
  });

  describe('the voices of one node', () => {
    const options = (table: string, more: Partial<VoiceOptions> = {}): VoiceOptions => ({
      osc: [{ table, unison: 1, phase: 0.25, phaseRand: 0 }, null],
      start: 0,
      envelopes: [FLAT, FLAT, FLAT],
      envStart: 0,
      routes: [],
      filter: null,
      phrase: 0,
      ...more,
    });
    const on = (voice: number, table: string, more: Partial<VoiceOptions> = {}): VoiceEvent => ({
      kind: 'on',
      voice,
      options: options(table, { phrase: voice, ...more }),
      params: { gain1: 1, frequency: 100 },
    });
    const renderNode = (processor: WorkletProcessorStub, frame: number, channels = 2) => {
      Object.assign(globalThis, { currentFrame: frame });
      const outputs = [Array.from({ length: channels }, () => new Float32Array(128))];
      const alive = processor.process([], outputs, {});
      return { alive, channels: outputs[0] };
    };
    const reports = (processor: WorkletProcessorStub) =>
      processor.port.postMessage.mock.calls.map(([message]) => message);

    it('plays the voices of the events posted to it, their sum into its output', () => {
      const store = new processors[STORE_PROCESSOR]({});
      store.port.onmessage({
        data: { table: 'node', version: 1, levels: buildLevels([sine.map((x) => x / 4)]) },
      });
      const node = new processors[VOICES_PROCESSOR]({});
      node.port.onmessage({ data: { events: [on(1, 'node'), on(2, 'node')] } });
      const { alive, channels } = renderNode(node, 0);
      expect(alive).toBe(true);
      // two voices of a quarter at phase 0.25
      expect(channels[0][0]).toBeCloseTo(0.5, 4);
      expect(channels[1][0]).toBeCloseTo(0.5, 4);
      expect(reports(node)).toEqual([]);
    });

    it('takes the events of its options before its first block, a tap renders each voice into its channels', () => {
      const node = new processors[VOICES_PROCESSOR]({
        processorOptions: {
          tap: true,
          events: [
            on(1, 'none'),
            on(2, 'none', { start: 64 / RATE, envStart: 64 / RATE }),
            { kind: 'set', voice: 1, param: 'gate', value: 0, time: 32 / RATE },
          ],
        },
      });
      const { channels } = renderNode(node, 0, 4);
      expect(channels[0][0]).toBeCloseTo(1, 4);
      expect(channels[0].subarray(32).every((value) => value === 0)).toBe(true);
      expect(channels[2][63]).toBe(0);
      expect(channels[2][64]).toBeCloseTo(1, 4);
      // voice 1 ended where its gate dropped
      expect(reports(node)).toEqual([{ ended: [1] }]);
      const next = renderNode(node, 128, 4).channels;
      expect(next[0].every((value) => value === 0)).toBe(true);
      expect(next[2][0]).not.toBe(0);
    });

    it('tells the starts later than scheduled and the ends of a block in one message', () => {
      const node = new processors[VOICES_PROCESSOR]({});
      renderNode(node, 0);
      node.port.onmessage({
        data: {
          events: [
            on(1, 'none', { start: 100 / RATE }),
            on(2, 'none', { start: 1300 / RATE, mono: true }),
            on(3, 'none', { start: 1300 / RATE }),
            { kind: 'set', voice: 3, param: 'gate', value: 0, time: 1350 / RATE },
          ],
        },
      });
      renderNode(node, 1280);
      expect(reports(node)).toEqual([
        {
          started: [
            [1, 1280, 100],
            [2, 1300, 1300],
          ],
          ended: [3],
        },
      ]);
    });

    it('stops: its voices end and give their versions back, it renders no more', () => {
      const store = new processors[STORE_PROCESSOR]({});
      store.port.onmessage({ data: { table: 'stopped', version: 1, levels: buildLevels([saw]) } });
      const node = new processors[VOICES_PROCESSOR]({});
      node.port.onmessage({ data: { events: [on(1, 'stopped')] } });
      renderNode(node, 0);
      store.port.onmessage({ data: { table: 'stopped', version: 2, levels: buildLevels([sine]) } });
      const held = stats(store);
      expect(held).toMatchObject({ scopeVoices: 1 });
      node.port.onmessage({ data: { stop: true } });
      expect(stats(store)).toMatchObject({ versions: held.versions - 1, scopeVoices: 0, events: 0 });
      expect(renderNode(node, 128).alive).toBe(false);
      // a message after the stop reaches nothing
      node.port.onmessage({ data: { events: [on(2, 'stopped')] } });
    });

    it('counts the voices of the node and the events of their timelines', () => {
      const store = new processors[STORE_PROCESSOR]({});
      const node = new processors[VOICES_PROCESSOR]({});
      node.port.onmessage({
        data: {
          events: [
            on(1, 'none'),
            { kind: 'set', voice: 1, param: 'gain1', value: 0.5, time: 1 },
            { kind: 'ramp', voice: 1, param: 'frequency', value: 200, time: 1 },
          ],
        },
      });
      expect(stats(store)).toMatchObject({ scopeVoices: 1, events: 2 });
      node.port.onmessage({ data: { stop: true } });
    });

    it('keeps playing when a message breaks the core: the error is told', () => {
      const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const node = new processors[VOICES_PROCESSOR]({});
      node.port.onmessage({ data: { events: [on(1, 'none')] } });
      // more routes than the command buffer holds: the core reads past it
      const routes = Array.from({ length: 1000 }, () => ({
        env: 1,
        param: 'gain1',
        amount: 1,
        min: 0,
        max: 1,
      }));
      node.port.onmessage({ data: { events: [{ kind: 'routes', voices: [1], routes }] } });
      expect(error).toHaveBeenCalledWith('A voice of the wavetable oscillator failed', expect.any(Error));
      expect(renderNode(node, 0).channels[0][0]).toBeCloseTo(1, 4);
      node.port.onmessage({ data: { stop: true } });
      error.mockRestore();
    });
  });
});
