import { installWorkletScope } from '../../../../test-utils/worklet-scope';
import { DISTORTION_PROCESSOR } from '../../common/processors';
import { DistortionDspParams } from './distortion-params';

const processors = installWorkletScope(48000);

const PARAMS: DistortionDspParams = { mode: 1, drive: 0, tone: 20000, level: 0 };

const block = (value: (i: number) => number) => Float32Array.from({ length: 128 }, (_, i) => value(i));
const loudest = (data: Float32Array) => data.reduce((max, value) => Math.max(max, Math.abs(value)), 0);

// the peak of the output over `blocks` blocks of a sine 6 dB over the curve
const peakOf = (
  processor: { process: (i: Float32Array[][], o: Float32Array[][]) => boolean },
  blocks = 8
) => {
  let peak = 0;
  for (let i = 0; i < blocks; i++) {
    const out = [[new Float32Array(128), new Float32Array(128)]];
    processor.process([[block((n) => 2 * Math.sin((i * 128 + n) / 9))]], out);
    if (i >= blocks / 2) peak = Math.max(peak, loudest(out[0][0]));
  }
  return peak;
};

describe('distortion wasm worklet', () => {
  beforeAll(() => import('./distortion.worklet'));

  it('registers the distortion processor with the Rust core, started with the node options', () => {
    expect(processors[DISTORTION_PROCESSOR]).toBeDefined();
    const clipped = new processors[DISTORTION_PROCESSOR]({ processorOptions: { params: PARAMS } });
    // hard clip at ±1, no makeup without drive (the oversampling filters ring a little over it)
    expect(peakOf(clipped)).toBeLessThan(1.2);
    expect(peakOf(clipped)).toBeGreaterThan(0.9);
  });

  it('applies the posted params and the knobs the envelopes move', () => {
    const processor = new processors[DISTORTION_PROCESSOR]({ processorOptions: { params: PARAMS } });
    processor.port.onmessage({ data: { params: { level: -12 } } });
    expect(peakOf(processor)).toBeLessThan(0.3);
    const routed = new processors[DISTORTION_PROCESSOR]({ processorOptions: { params: PARAMS } });
    routed.port.onmessage({
      data: {
        mod: {
          note: {
            start: 0,
            release: null,
            envelopes: [0, 1, 2].map(() => ({ attack: 0, hold: 0, decay: 0, sustain: 1, release: 0 })),
          },
          routes: [{ source: 1, param: 'level', amount: -12, min: -24, max: 12 }],
        },
      },
    });
    expect(peakOf(routed, 16)).toBeLessThan(0.3);
  });

  it('ends once stopped', () => {
    const processor = new processors[DISTORTION_PROCESSOR]({ processorOptions: { params: PARAMS } });
    processor.port.onmessage({ data: { stop: true } });
    expect(processor.process([[]], [[new Float32Array(128), new Float32Array(128)]])).toBe(false);
  });
});
