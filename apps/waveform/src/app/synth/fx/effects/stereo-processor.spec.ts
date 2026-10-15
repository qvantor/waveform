import { installWorkletScope } from '../../../../test-utils/worklet-scope';
import { registerStereoProcessor, StereoDsp } from './stereo-processor';

const processors = installWorkletScope(44100);

const OPTIONS = { processorOptions: { a: 1 } };

const setup = () => {
  const dsp = { process: jest.fn() };
  const createDsp = jest.fn((): StereoDsp => dsp);
  const onMessage = jest.fn();
  registerStereoProcessor('test', createDsp, onMessage);
  const processor = new processors['test'](OPTIONS);
  const outputs = [[new Float32Array(128), new Float32Array(128)]];
  return { processor, dsp, createDsp, onMessage, outputs };
};

describe('registerStereoProcessor', () => {
  it('registers the processor, its dsp starts with the node options at the context rate', () => {
    const { createDsp } = setup();
    expect(createDsp).toHaveBeenCalledWith(44100, OPTIONS);
  });

  it('renders both input channels into both outputs and keeps running', () => {
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

  it('passes the posted messages to the dsp', () => {
    const { processor, dsp, onMessage } = setup();
    processor.port.onmessage({ data: { a: 2 } });
    expect(onMessage).toHaveBeenCalledWith(dsp, { a: 2 });
  });

  it('ends after stop', () => {
    const { processor, dsp, outputs } = setup();
    processor.port.onmessage({ data: {} });
    expect(processor.process([[]], outputs)).toBe(true);
    processor.port.onmessage({ data: { stop: true } });
    expect(processor.process([[]], outputs)).toBe(false);
    expect(dsp.process).toHaveBeenCalledTimes(1);
  });
});
