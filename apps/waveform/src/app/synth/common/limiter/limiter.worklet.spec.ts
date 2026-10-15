import { installWorkletScope } from '../../../../test-utils/worklet-scope';
import { createLimiterDsp, LIMITER_PROCESSOR } from './limiter-dsp';

jest.mock('./limiter-dsp', () => ({
  ...jest.requireActual('./limiter-dsp'),
  createLimiterDsp: jest.fn(() => ({ process: jest.fn() })),
}));

const processors = installWorkletScope(44100);

describe('limiter worklet', () => {
  beforeAll(() => import('./limiter.worklet'));

  it('registers the limiter processor, its dsp runs at the context rate', () => {
    expect(processors[LIMITER_PROCESSOR]).toBeDefined();
    new processors[LIMITER_PROCESSOR]({});
    expect(createLimiterDsp).toHaveBeenLastCalledWith(44100);
  });

  it('limits both input channels into both outputs', () => {
    const processor = new processors[LIMITER_PROCESSOR]({});
    const dsp = (createLimiterDsp as jest.Mock).mock.results.at(-1)?.value;
    const [inL, inR] = [new Float32Array(128), new Float32Array(128)];
    const outputs = [[new Float32Array(128), new Float32Array(128)]];
    expect(processor.process([[inL, inR]], outputs)).toBe(true);
    expect(dsp.process).toHaveBeenCalledWith(inL, inR, ...outputs[0]);
  });
});
