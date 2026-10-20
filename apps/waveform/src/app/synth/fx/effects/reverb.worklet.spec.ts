import { installWorkletScope } from '../../../../test-utils/worklet-scope';
import { createReverbDsp, REVERB_PROCESSOR, ReverbOptions } from './reverb-dsp';

jest.mock('./reverb-dsp', () => ({
  ...jest.requireActual('./reverb-dsp'),
  createReverbDsp: jest.fn(() => ({ set: jest.fn(), setActive: jest.fn(), process: jest.fn() })),
}));

const processors = installWorkletScope(48000);

const OPTIONS = { params: { decay: 2 }, active: false } as unknown as ReverbOptions;

const setup = () => {
  const processor = new processors[REVERB_PROCESSOR]({ processorOptions: OPTIONS });
  const dsp = (createReverbDsp as jest.Mock).mock.results.at(-1)?.value;
  const outputs = [[new Float32Array(128), new Float32Array(128)]];
  return { processor, dsp, outputs };
};

describe('reverb worklet', () => {
  beforeAll(() => import('./reverb.worklet'));

  it('registers the reverb processor, its dsp starts with the node options at the context rate', () => {
    expect(processors[REVERB_PROCESSOR]).toBeDefined();
    setup();
    expect(createReverbDsp).toHaveBeenLastCalledWith(48000, OPTIONS);
  });

  it('renders both input channels into both outputs', () => {
    const { processor, dsp, outputs } = setup();
    const [inL, inR] = [new Float32Array(128), new Float32Array(128)];
    expect(processor.process([[inL, inR]], outputs)).toBe(true);
    expect(dsp.process).toHaveBeenCalledWith(inL, inR, ...outputs[0]);
  });

  it('applies the posted params and the active flag', () => {
    const { processor, dsp } = setup();
    processor.port.onmessage({ data: { params: { decay: 5 } } });
    processor.port.onmessage({ data: { active: true } });
    processor.port.onmessage({ data: { params: { size: 1 }, active: false } });
    expect(dsp.set.mock.calls).toEqual([[{ decay: 5 }], [{ size: 1 }]]);
    expect(dsp.setActive.mock.calls).toEqual([[true], [false]]);
  });

  it('sets the knobs the envelopes move as routed: they glide without their tape glide', () => {
    const { processor, dsp, outputs } = setup();
    const env = { attack: 0, hold: 0, decay: 1, sustain: 0, release: 0 };
    processor.port.onmessage({
      data: {
        mod: {
          note: { envelopes: [env, env, env], start: 0, release: null },
          routes: [{ param: 'decay', env: 1, amount: 2, min: 0.1, max: 20 }],
        },
      },
    });
    processor.process([[]], outputs);
    expect(dsp.set).toHaveBeenLastCalledWith({ decay: 4 }, true);
  });

  it('stops after the effect is destroyed', () => {
    const { processor, dsp, outputs } = setup();
    processor.port.onmessage({ data: { stop: true } });
    expect(processor.process([[]], outputs)).toBe(false);
    expect(dsp.process).not.toHaveBeenCalled();
    expect(dsp.set).not.toHaveBeenCalled();
    expect(dsp.setActive).not.toHaveBeenCalled();
  });
});
