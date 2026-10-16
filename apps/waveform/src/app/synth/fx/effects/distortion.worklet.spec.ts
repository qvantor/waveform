import { installWorkletScope } from '../../../../test-utils/worklet-scope';
import { createDistortionDsp, DISTORTION_PROCESSOR, DistortionOptions } from './distortion-dsp';

jest.mock('./distortion-dsp', () => ({
  ...jest.requireActual('./distortion-dsp'),
  createDistortionDsp: jest.fn(() => ({ set: jest.fn(), process: jest.fn() })),
}));

const processors = installWorkletScope(48000);

const OPTIONS: DistortionOptions = { params: { mode: 1, drive: 6, tone: 8000, level: -3 } };

const setup = () => {
  const processor = new processors[DISTORTION_PROCESSOR]({ processorOptions: OPTIONS });
  const dsp = (createDistortionDsp as jest.Mock).mock.results.at(-1)?.value;
  const outputs = [[new Float32Array(128), new Float32Array(128)]];
  return { processor, dsp, outputs };
};

describe('distortion worklet', () => {
  beforeAll(() => import('./distortion.worklet'));

  it('registers the distortion processor, its dsp starts with the node options at the context rate', () => {
    expect(processors[DISTORTION_PROCESSOR]).toBeDefined();
    setup();
    expect(createDistortionDsp).toHaveBeenLastCalledWith(48000, OPTIONS);
  });

  it('renders both input channels into both outputs', () => {
    const { processor, dsp, outputs } = setup();
    const [inL, inR] = [new Float32Array(128), new Float32Array(128)];
    expect(processor.process([[inL, inR]], outputs)).toBe(true);
    expect(dsp.process).toHaveBeenCalledWith(inL, inR, ...outputs[0]);
  });

  it('a mono input feeds both sides', () => {
    const { processor, dsp, outputs } = setup();
    const input = new Float32Array(128);
    processor.process([[input]], outputs);
    expect(dsp.process).toHaveBeenCalledWith(input, input, ...outputs[0]);
  });

  it('applies the posted params', () => {
    const { processor, dsp } = setup();
    processor.port.onmessage({ data: { params: { drive: 12 } } });
    processor.port.onmessage({ data: { params: { mode: 0, tone: 500 } } });
    expect(dsp.set.mock.calls).toEqual([[{ drive: 12 }], [{ mode: 0, tone: 500 }]]);
  });

  it('stops after the effect is destroyed', () => {
    const { processor, dsp, outputs } = setup();
    processor.port.onmessage({ data: { stop: true } });
    expect(processor.process([[]], outputs)).toBe(false);
    expect(dsp.process).not.toHaveBeenCalled();
    expect(dsp.set).not.toHaveBeenCalled();
  });
});
