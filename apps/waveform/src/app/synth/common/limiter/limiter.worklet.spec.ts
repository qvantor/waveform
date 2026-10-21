import { installWorkletScope } from '../../../../test-utils/worklet-scope';
import { LIMITER_PROCESSOR } from '../processors';
import { wasmCore } from '../../../../test-utils/wasm';
import { CEILING } from './limiter-params';
import { createLimiterWasm, LimiterExports } from './limiter-wasm';

const processors = installWorkletScope(44100);

const block = (value: (i: number) => number) => Float32Array.from({ length: 128 }, (_, i) => value(i));

describe('limiter wasm worklet', () => {
  beforeAll(() => import('./limiter.worklet'));

  it('registers the limiter processor with the Rust core at the context rate', () => {
    expect(processors[LIMITER_PROCESSOR]).toBeDefined();
    const processor = new processors[LIMITER_PROCESSOR]({});
    const node = createLimiterWasm(wasmCore<LimiterExports>('limiter'), 44100);
    const input = block((i) => 0.5 * Math.sin(i / 3));
    const [outL, outR, nodeL, nodeR] = [0, 1, 2, 3].map(() => new Float32Array(128));
    for (let i = 0; i < 4; i++) {
      expect(processor.process([[input, input]], [[outL, outR]])).toBe(true);
      node.process(input, input, nodeL, nodeR);
    }
    // below the ceiling the sound passes, delayed: as its core in Node
    expect(outL).toEqual(nodeL);
    expect(outR).toEqual(nodeR);
  });

  it('limits a loud input to the ceiling, a mono input on both sides', () => {
    const processor = new processors[LIMITER_PROCESSOR]({});
    const [outL, outR] = [new Float32Array(128), new Float32Array(128)];
    for (let i = 0; i < 8; i++) processor.process([[block((n) => 4 * Math.sin(n / 5))]], [[outL, outR]]);
    expect(Math.max(...outL.map(Math.abs))).toBeLessThanOrEqual(Math.fround(CEILING));
    expect(Math.max(...outL.map(Math.abs))).toBeGreaterThan(CEILING / 2);
    expect(outR).toEqual(outL);
  });

  it('ends once stopped', () => {
    const processor = new processors[LIMITER_PROCESSOR]({});
    processor.port.onmessage({ data: { stop: true } });
    processor.port.onmessage({ data: { stop: true } });
    expect(processor.process([[]], [[new Float32Array(128), new Float32Array(128)]])).toBe(false);
  });
});
