import { installWorkletScope } from '../../test-utils/worklet-scope';
import { PROBE_PROCESSOR } from './probe-dsp';

const processors = installWorkletScope(48000);

const probe = () =>
  new processors[PROBE_PROCESSOR]({ numberOfInputs: 2, processorOptions: { threshold: 0.1, quiet: 4 } });
const signal = (index: number) => {
  const values = new Float32Array(128);
  values[index] = 1;
  return values;
};

describe('probe worklet', () => {
  beforeAll(() => import('./probe.worklet'));

  it('posts the onsets of each input at their frame, its output silent', () => {
    const processor = probe();
    Object.assign(globalThis, { currentFrame: 256 });
    const outputs = [[Float32Array.from({ length: 128 }, () => 1)]];
    expect(processor.process([[signal(10)], [signal(20)]], outputs)).toBe(true);
    expect(processor.port.postMessage.mock.calls).toEqual([
      [{ onset: 266, input: 0 }],
      [{ onset: 276, input: 1 }],
    ]);
    expect(outputs[0][0].every((value) => value === 0)).toBe(true);
  });

  it('takes the defaults without options', () => {
    const processor = new processors[PROBE_PROCESSOR]({ numberOfInputs: 1 });
    Object.assign(globalThis, { currentFrame: 0 });
    const quiet = new Float32Array(128).fill(0.0005);
    processor.process([[quiet]], [[new Float32Array(128)]]);
    expect(processor.port.postMessage).not.toHaveBeenCalled();
  });

  it('ends once stopped', () => {
    const processor = probe();
    processor.port.onmessage({ data: { stop: true } });
    expect(processor.process([[signal(0)], []], [[new Float32Array(128)]])).toBe(false);
    expect(processor.port.postMessage).not.toHaveBeenCalled();
  });
});
