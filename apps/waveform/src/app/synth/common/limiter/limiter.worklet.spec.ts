import { createLimiterDsp, LIMITER_PROCESSOR, LimiterMessage } from './limiter-dsp';

jest.mock('./limiter-dsp', () => ({
  ...jest.requireActual('./limiter-dsp'),
  createLimiterDsp: jest.fn(() => ({ process: jest.fn(), latency: 0 })),
}));

interface Processor {
  port: { onmessage: (event: { data: LimiterMessage }) => void };
  process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean;
}

// the AudioWorkletGlobalScope of the module
const processors: Record<string, new () => Processor> = {};
Object.assign(globalThis, {
  sampleRate: 44100,
  AudioWorkletProcessor: class {
    port = { onmessage: null };
  },
  registerProcessor: (name: string, processor: new () => Processor) => {
    processors[name] = processor;
  },
});

const setup = () => {
  const processor = new processors[LIMITER_PROCESSOR]();
  const dsp = (createLimiterDsp as jest.Mock).mock.results.at(-1)?.value;
  const outputs = [[new Float32Array(128), new Float32Array(128)]];
  return { processor, dsp, outputs };
};

describe('limiter worklet', () => {
  beforeAll(() => import('./limiter.worklet'));

  it('registers the limiter processor, its dsp runs at the context rate', () => {
    expect(processors[LIMITER_PROCESSOR]).toBeDefined();
    setup();
    expect(createLimiterDsp).toHaveBeenLastCalledWith(44100);
  });

  it('limits both input channels into both outputs and keeps running', () => {
    const { processor, dsp, outputs } = setup();
    const [inL, inR] = [new Float32Array(128), new Float32Array(128)];
    expect(processor.process([[inL, inR]], outputs)).toBe(true);
    expect(dsp.process).toHaveBeenCalledWith(inL, inR, ...outputs[0]);
  });

  it('a mono input feeds both sides, a disconnected one is silence', () => {
    const { processor, dsp, outputs } = setup();
    const mono = new Float32Array(128);
    processor.process([[mono]], outputs);
    expect(dsp.process).toHaveBeenLastCalledWith(mono, mono, ...outputs[0]);
    processor.process([[]], outputs);
    const [silence, right] = dsp.process.mock.lastCall;
    expect(right).toBe(silence);
    expect(silence).toEqual(new Float32Array(128));
  });

  it('stops after the synth is gone', () => {
    const { processor, dsp, outputs } = setup();
    processor.port.onmessage({ data: {} });
    expect(processor.process([[]], outputs)).toBe(true);
    processor.port.onmessage({ data: { stop: true } });
    expect(processor.process([[]], outputs)).toBe(false);
    expect(dsp.process).toHaveBeenCalledTimes(1);
  });
});
