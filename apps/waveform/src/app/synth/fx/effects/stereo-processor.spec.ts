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

  it('frees its dsp once on stop, the messages after it never reach the dsp', () => {
    const free = jest.fn();
    const onMessage = jest.fn();
    registerStereoProcessor('freed', () => ({ process: jest.fn(), free }), onMessage);
    const processor = new processors['freed'](OPTIONS);
    processor.port.onmessage({ data: { stop: true } });
    processor.port.onmessage({ data: { a: 2 } });
    processor.port.onmessage({ data: { stop: true } });
    expect(free).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledTimes(1);
  });

  describe('modulation', () => {
    const ENV = { attack: 0.1, hold: 0, decay: 0.1, sustain: 0.5, release: 0.2 };
    const setupModulated = () => {
      const dsp = { process: jest.fn() };
      const onMessage = jest.fn();
      const modulate = jest.fn();
      registerStereoProcessor('modulated', () => dsp, onMessage, modulate);
      const processor = new processors['modulated']({
        processorOptions: { params: { drive: 2, tone: 8000 } },
      });
      const outputs = [[new Float32Array(128), new Float32Array(128)]];
      const block = (seconds: number) => {
        Object.assign(globalThis, { currentFrame: Math.round(seconds * 44100) });
        processor.process([[]], outputs);
      };
      return { processor, dsp, onMessage, modulate, block };
    };

    it('sets the knobs its routes move once per block, from the knobs of its options', () => {
      const { processor, dsp, modulate, block } = setupModulated();
      block(0);
      expect(modulate).not.toHaveBeenCalled();
      processor.port.onmessage({
        data: {
          mod: {
            note: { envelopes: [ENV, ENV, ENV], start: 1, release: null },
            routes: [{ param: 'drive', env: 1, amount: 6, min: 0, max: 12 }],
          },
        },
      });
      block(1.1);
      expect(modulate).toHaveBeenLastCalledWith(dsp, { drive: expect.closeTo(8, 3) });
      block(2);
      block(3);
      expect(modulate).toHaveBeenCalledTimes(2);
      expect(modulate).toHaveBeenLastCalledWith(dsp, { drive: 5 });
    });

    it('a posted knob its routes move goes to them, the others to the dsp', () => {
      const { processor, dsp, onMessage, modulate, block } = setupModulated();
      processor.port.onmessage({
        data: {
          mod: {
            note: { envelopes: [ENV, ENV, ENV], start: 1, release: null },
            routes: [{ param: 'drive', env: 1, amount: 6, min: 0, max: 12 }],
          },
        },
      });
      processor.port.onmessage({ data: { params: { drive: 4, tone: 5000 } } });
      expect(onMessage).toHaveBeenLastCalledWith(dsp, { params: { tone: 5000 } });
      block(5);
      expect(modulate).toHaveBeenLastCalledWith(dsp, { drive: 7 });
    });
  });
});
