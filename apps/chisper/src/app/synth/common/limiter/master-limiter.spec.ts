import { FxStatus } from '../../fx/effects/types';
import { LIMITER_PROCESSOR } from '../processors';
import { createMasterLimiter } from './master-limiter';

interface WorkletNodeStub extends AudioWorkletNode {
  name: string;
  options: AudioWorkletNodeOptions;
}

// the worklet module loads asynchronously: the node exists after the pending promises settle
const flush = () => new Promise((resolve) => setTimeout(resolve));

const lastTarget = (node: AudioNode) => (node.connect as jest.Mock).mock.lastCall?.[0];

const setup = () => {
  const audioCtx = new AudioContext();
  const limiter = createMasterLimiter(audioCtx);
  const statuses: FxStatus[] = [];
  limiter.$status.subscribe((status) => statuses.push(status));
  return { audioCtx, limiter, statuses };
};

// the rest (unsupported without AudioWorklet, a failed module or processor: silent, retry, destroy) is the one of
// every worklet effect: worklet-fx.spec.ts
describe('createMasterLimiter', () => {
  it('is silent while the limiter module loads (with its Rust core)', () => {
    const { audioCtx, limiter, statuses } = setup();
    expect(statuses).toEqual(['loading']);
    expect(audioCtx.audioWorklet.addModule).toHaveBeenCalledWith(
      expect.stringMatching(/\/assets\/worklets\/limiter\.js$/)
    );
    expect(limiter.input.connect).not.toHaveBeenCalled();
  });

  it('is unsupported without wasm SIMD (Safari before 16.4)', async () => {
    const validate = jest.spyOn(WebAssembly, 'validate').mockReturnValue(false);
    const { audioCtx, limiter, statuses } = setup();
    validate.mockRestore();
    await flush();
    expect(statuses).toEqual(['unsupported']);
    expect(audioCtx.audioWorklet.addModule).not.toHaveBeenCalled();
    expect(limiter.input.connect).not.toHaveBeenCalled();
  });

  it('connects the input through the limiter processor once it is ready', async () => {
    const { limiter, statuses } = setup();
    await flush();
    expect(statuses).toEqual(['loading', 'ready']);
    const node = lastTarget(limiter.input) as WorkletNodeStub;
    expect(node.name).toBe(LIMITER_PROCESSOR);
    // stereo out, a mono input is upmixed to both channels
    expect(node.options).toEqual({
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
    expect(node.connect).toHaveBeenCalledWith(limiter.output);
  });
});
