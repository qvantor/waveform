import { installWorkletScope } from '../../../../test-utils/worklet-scope';
import { REVERB_PROCESSOR } from '../../common/processors';
import type { FxModMessage } from './fx-modulation';
import { ReverbDspParams } from './reverb-dsp';

const processors = installWorkletScope(48000);

const PARAMS: ReverbDspParams = {
  lowcut: 20,
  pre: 0,
  size: 0.5,
  decay: 2,
  damp: 6000,
  bass: 1,
  depth: 0.2,
  sep: 1,
  er: 0.5,
  drive: 0,
  bandwidth: 24000,
  body: 0,
};

const outputs = () => [[new Float32Array(128), new Float32Array(128)]];
const impulse = () => Float32Array.from({ length: 128 }, (_, i) => (i === 0 ? 1 : 0));
const silence = () => new Float32Array(128);
const energy = (blocks: Float32Array[][][]) =>
  blocks.reduce((sum, [[l]]) => sum + l.reduce((s, v) => s + v * v, 0), 0);

// blocks of the processor after an impulse
const render = (processor: { process: (i: Float32Array[][], o: Float32Array[][]) => boolean }, blocks = 40) =>
  Array.from({ length: blocks }, (_, i) => {
    const out = outputs();
    processor.process([[i === 0 ? impulse() : silence()]], out);
    return out;
  });

describe('reverb wasm worklet', () => {
  beforeAll(() => import('./reverb.wasm.worklet'));

  it('registers the reverb processor with the Rust core, started with the node options', () => {
    expect(processors[REVERB_PROCESSOR]).toBeDefined();
    const active = new processors[REVERB_PROCESSOR]({ processorOptions: { params: PARAMS, active: true } });
    const inactive = new processors[REVERB_PROCESSOR]({
      processorOptions: { params: PARAMS, active: false },
    });
    expect(energy(render(active))).toBeGreaterThan(0.01);
    expect(energy(render(inactive))).toBe(0);
  });

  it('applies the posted params and the active flag', () => {
    const long = new processors[REVERB_PROCESSOR]({ processorOptions: { params: PARAMS, active: true } });
    const short = new processors[REVERB_PROCESSOR]({ processorOptions: { params: PARAMS, active: true } });
    short.port.onmessage({ data: { params: { decay: 0.1 } } });
    // the tail from 50 ms on: much quieter with a decay of 0.1 s
    const tail = (processor: Parameters<typeof render>[0]) => energy(render(processor, 80).slice(20));
    expect(tail(short)).toBeLessThan(tail(long) / 10);
    const inactive = new processors[REVERB_PROCESSOR]({
      processorOptions: { params: PARAMS, active: false },
    });
    inactive.port.onmessage({ data: { active: true } });
    expect(energy(render(inactive))).toBeGreaterThan(0);
  });

  it('takes the knobs the envelopes move once per block', () => {
    // ENV 2 holds ER at its top: the early reflections come back
    const message: FxModMessage = {
      mod: {
        note: {
          start: 0,
          release: null,
          envelopes: [0, 1, 2].map(() => ({ attack: 0, hold: 0, decay: 0, sustain: 1, release: 0 })),
        },
        routes: [{ env: 1, param: 'er', amount: 1, min: 0, max: 1 }],
      },
    };
    const routed = new processors[REVERB_PROCESSOR]({
      processorOptions: { params: { ...PARAMS, er: 0, decay: 0.1 }, active: true },
    });
    const still = new processors[REVERB_PROCESSOR]({
      processorOptions: { params: { ...PARAMS, er: 0, decay: 0.1 }, active: true },
    });
    routed.port.onmessage({ data: message });
    expect(energy(render(routed, 6))).toBeGreaterThan(energy(render(still, 6)));
  });

  it('ends once stopped', () => {
    const processor = new processors[REVERB_PROCESSOR]({
      processorOptions: { params: PARAMS, active: true },
    });
    processor.port.onmessage({ data: { stop: true } });
    expect(processor.process([[]], outputs())).toBe(false);
  });
});
