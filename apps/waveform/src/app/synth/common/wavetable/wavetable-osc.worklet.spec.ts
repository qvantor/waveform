import { installWorkletScope, WorkletProcessorStub } from '../../../../test-utils/worklet-scope';
import { buildLevels } from './wavetable-mipmap';
import { STORE_PROCESSOR, VOICE_PARAMETERS, VOICE_PROCESSOR, VoiceParam } from './wavetable-osc-params';

const RATE = 48000;
const processors = installWorkletScope(RATE);

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

const voice = (table: string, options: Partial<{ start: number }> = {}) =>
  new processors[VOICE_PROCESSOR]({
    processorOptions: { osc: [{ table, unison: 1, phase: 0.25, phaseRand: 0 }, null], start: 0, ...options },
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

describe('wavetable oscillator worklet', () => {
  beforeAll(() => import('./wavetable-osc.worklet'));

  it('registers the store and the voice processor with the params of the voice', () => {
    expect(processors[STORE_PROCESSOR]).toBeDefined();
    expect(processors[VOICE_PROCESSOR].parameterDescriptors).toBe(VOICE_PARAMETERS);
  });

  it('stores a table posted to the store node and acknowledges it, voices play it', () => {
    const store = new processors[STORE_PROCESSOR]({});
    store.port.onmessage({
      data: { table: 'posted', version: 1, levels: buildLevels([sine.map((x) => x / 2)]) },
    });
    expect(store.port.postMessage).toHaveBeenCalledWith({ stored: 'posted', version: 1 });
    // a frame is normalized to its peak: the halved sine plays at 1, from the phase 0.25 (its peak)
    const { left, right, alive } = render(voice('posted'), 0);
    expect(alive).toBe(true);
    expect(left[0]).toBeCloseTo(1, 4);
    expect(right[0]).toBeCloseTo(1, 4);
  });

  it('takes the tables from the port of the worker', () => {
    const store = new processors[STORE_PROCESSOR]({});
    const port = workerPort();
    store.port.onmessage({ data: { port } });
    port.onmessage?.({ data: { table: 'worker', version: 1, levels: buildLevels([saw]) } });
    expect(store.port.postMessage).toHaveBeenCalledWith({ stored: 'worker', version: 1 });
    const { left } = render(voice('worker'), 0);
    expect(left.some((value) => value !== 0)).toBe(true);
  });

  it('gives the buffer of a version no voice plays back to the worker', () => {
    const store = new processors[STORE_PROCESSOR]({});
    const port = workerPort();
    store.port.onmessage({ data: { port } });
    const first = buildLevels([saw]);
    port.onmessage?.({ data: { table: 'freed', version: 1, levels: first } });
    port.onmessage?.({ data: { table: 'freed', version: 2, levels: buildLevels([sine]) } });
    expect(port.postMessage).toHaveBeenCalledWith({ freed: first.data.buffer }, [first.data.buffer]);
  });

  it('removes a table: new voices play the sine until it comes again', () => {
    const store = new processors[STORE_PROCESSOR]({});
    store.port.onmessage({ data: { table: 'removed', version: 1, levels: buildLevels([saw]) } });
    store.port.onmessage({ data: { table: 'removed', version: 2, remove: true } });
    const { left } = render(voice('removed'), 0);
    expect(left[0]).toBeCloseTo(1, 4);
    expect(left[64]).toBeCloseTo(Math.cos((2 * Math.PI * 100 * 64) / RATE), 4);
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
    const port = workerPort();
    store.port.onmessage({ data: { port } });
    const first = buildLevels([saw]);
    port.onmessage?.({ data: { table: 'thrown', version: 1, levels: first } });
    const processor = voice('thrown');
    render(processor, 0);
    // the voice holds version 1: a newer one doesn't free it
    port.onmessage?.({ data: { table: 'thrown', version: 2, levels: buildLevels([sine]) } });
    expect(port.postMessage).not.toHaveBeenCalledWith({ freed: first.data.buffer }, [first.data.buffer]);

    // no frequency: process() throws
    const broken: Partial<Record<VoiceParam, Float32Array>> = params({ gain1: 1, frequency: 100 });
    delete broken.frequency;
    const { alive, left, right } = render(processor, 128, broken as Record<VoiceParam, Float32Array>);

    expect(alive).toBe(false);
    expect(left.every((value) => value === 0)).toBe(true);
    expect(right.every((value) => value === 0)).toBe(true);
    expect(processor.port.postMessage).toHaveBeenCalledWith({ ended: true });
    expect(port.postMessage).toHaveBeenCalledWith({ freed: first.data.buffer }, [first.data.buffer]);
    expect(error).toHaveBeenCalledWith('A voice of the wavetable oscillator failed', expect.any(TypeError));
    error.mockRestore();
  });

  it('renders into one channel when the node has one', () => {
    const outputs = [[new Float32Array(128)]];
    Object.assign(globalThis, { currentFrame: 0 });
    expect(voice('none').process([], outputs, params({ gain1: 1 }))).toBe(true);
    expect(outputs[0][0][0]).toBeCloseTo(1, 4);
  });
});
