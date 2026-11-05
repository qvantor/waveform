import { installWorkletScope, WorkletProcessorStub } from '../../../../test-utils/worklet-scope';
import { buildLevels } from './wavetable-mipmap';
import { STORE_PROCESSOR, VOICES_PROCESSOR } from './wavetable-osc-params';

const processors = installWorkletScope(48000);

// the stores the module makes, in order: its own, then the prewarm's (their takeKernels spied)
const mockStores: { takeKernels: jest.Mock; handle: number }[] = [];

// the scope of voices of the prewarm fails (after its samples: the kernels of the noise are built); those of the
// nodes are made
jest.mock('./wavetable-osc-wasm', () => {
  const actual = jest.requireActual('./wavetable-osc-wasm');
  return {
    ...actual,
    createTableStoreWasm: (...args: unknown[]) => {
      const store = actual.createTableStoreWasm(...args);
      jest.spyOn(store, 'takeKernels');
      mockStores.push(store);
      return store;
    },
    createVoiceScopeWasm: jest.fn(actual.createVoiceScopeWasm).mockImplementationOnce(() => {
      throw new Error('a trap of the prewarm');
    }),
  };
});

const FLAT = { attack: 0, hold: 0, decay: 0, sustain: 1, release: 0 };
const sine = Array.from({ length: 2048 }, (_, n) => Math.sin((2 * Math.PI * n) / 2048));

const nodes: WorkletProcessorStub[] = [];
afterEach(() => nodes.splice(0).forEach((processor) => processor.port.onmessage({ data: { stop: true } })));

describe('a wavetable oscillator worklet whose prewarm fails', () => {
  // (the calls as the module loaded: clearMocks clears them before every test)
  let logged: unknown[][] = [];
  let taken: unknown[][] = [];
  beforeAll(async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await import('./wavetable-osc.worklet');
    logged = [...error.mock.calls];
    taken = [...mockStores[0].takeKernels.mock.calls];
    error.mockRestore();
  });

  it('logs it, gives the kernels the prewarm built to the store of the scope and registers the processors', () => {
    expect(logged).toEqual([['The prewarm of the wavetable oscillator failed', expect.any(Error)]]);
    expect(mockStores).toHaveLength(2);
    expect(taken).toEqual([[mockStores[1]]]);
    expect(processors[STORE_PROCESSOR]).toBeDefined();
    expect(processors[VOICES_PROCESSOR]).toBeDefined();
  });

  it('plays all the same', () => {
    const store = new processors[STORE_PROCESSOR]({});
    store.port.onmessage({
      data: { table: 'posted', version: 1, levels: buildLevels([sine.map((x) => x / 2)]) },
    });
    expect(store.port.postMessage).toHaveBeenCalledWith({ stored: 'posted', version: 1 });
    const voices = new processors[VOICES_PROCESSOR]({
      processorOptions: {
        events: [
          {
            kind: 'on',
            voice: 1,
            options: {
              osc: [{ table: 'posted', unison: 1, phase: 0.25, phaseRand: 0 }, null],
              start: 0,
              envStart: 0,
              envelopes: [FLAT, FLAT, FLAT],
              routes: [],
              filter: null,
              phrase: 0,
            },
            params: { gain1: 1, frequency: 100 },
          },
        ],
      },
    });
    nodes.push(voices);
    Object.assign(globalThis, { currentFrame: 0 });
    const [left, right] = [new Float32Array(128), new Float32Array(128)];
    expect(voices.process([], [[left, right]], {})).toBe(true);
    expect(left[0]).toBeCloseTo(0.5, 4);
    expect(right[0]).toBeCloseTo(0.5, 4);
  });
});
