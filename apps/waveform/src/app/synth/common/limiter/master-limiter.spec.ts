import { withoutAudioWorklet } from '../../../../test-utils/no-audio-worklet';
import { FxStatus } from '../../fx/effects/types';
import { LIMITER_PROCESSOR } from './limiter-dsp';
import { compressorMakeupGain, createMasterLimiter, FALLBACK_LIMITER } from './master-limiter';

interface WorkletNodeStub extends AudioWorkletNode {
  name: string;
  options: AudioWorkletNodeOptions;
  port: AudioWorkletNode['port'] & { postMessage: jest.Mock };
}

// the worklet module loads asynchronously: the node exists after the pending promises settle
const flush = () => new Promise((resolve) => setTimeout(resolve));

const db = (gain: number) => 20 * Math.log10(gain);
// the hard knee curve of a DynamicsCompressorNode, dB in → dB out
const curve = (input: number, threshold: number, ratio: number) =>
  input < threshold ? input : threshold + (input - threshold) / ratio;
// the static level (dB) the compressor outputs: its curve plus the makeup gain it adds
const compressed = (input: number) =>
  curve(input, FALLBACK_LIMITER.threshold, FALLBACK_LIMITER.ratio) +
  db(compressorMakeupGain(FALLBACK_LIMITER));

const lastTarget = (node: AudioNode) => (node.connect as jest.Mock).mock.lastCall?.[0];

const setup = () => {
  const audioCtx = new AudioContext();
  const limiter = createMasterLimiter(audioCtx);
  const statuses: FxStatus[] = [];
  limiter.$status.subscribe((status) => statuses.push(status));
  // input → worklet input → node → worklet output → output, once it is ready
  const worklet = () => {
    const input = lastTarget(limiter.input) as GainNode;
    const node = lastTarget(input) as WorkletNodeStub;
    return { input, node, output: lastTarget(node) as GainNode };
  };
  return { audioCtx, limiter, statuses, worklet };
};

describe('createMasterLimiter', () => {
  it('plays through the compressor while the limiter module loads (with its Rust core)', () => {
    const { audioCtx, limiter, statuses } = setup();
    expect(statuses).toEqual(['loading']);
    expect(audioCtx.audioWorklet.addModule).toHaveBeenCalledWith(
      expect.stringMatching(/\/assets\/worklets\/limiter\.wasm\.js$/)
    );
    expect(lastTarget(limiter.input)).toBe(limiter.compressor);
    expect(limiter.compressor.connect).toHaveBeenCalledWith(limiter.compensation);
    expect(limiter.compensation.connect).toHaveBeenCalledWith(limiter.output);
  });

  it('stays on the compressor without wasm SIMD (Safari before 16.4)', async () => {
    const validate = jest.spyOn(WebAssembly, 'validate').mockReturnValue(false);
    const { audioCtx, limiter, statuses } = setup();
    validate.mockRestore();
    await flush();
    expect(statuses).toEqual(['unsupported']);
    expect(audioCtx.audioWorklet.addModule).not.toHaveBeenCalled();
    expect(lastTarget(limiter.input)).toBe(limiter.compressor);
  });

  it('switches the input to the limiter worklet once it is ready', async () => {
    const { limiter, statuses, worklet } = setup();
    await flush();
    expect(statuses).toEqual(['loading', 'ready']);
    expect(limiter.input.disconnect).toHaveBeenCalled();
    const { input, node, output } = worklet();
    expect(input).not.toBe(limiter.compressor);
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
    expect(output.connect).toHaveBeenCalledWith(limiter.output);
    expect(limiter.input.connect).toHaveBeenCalledTimes(2);
  });

  it('stays on the compressor without AudioWorklet', async () => {
    withoutAudioWorklet();
    const { limiter, statuses } = setup();
    await flush();
    expect(statuses).toEqual(['unsupported']);
    expect(lastTarget(limiter.input)).toBe(limiter.compressor);
  });

  it('stays on the compressor when the module fails to load', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const audioCtx = new AudioContext();
    (audioCtx.audioWorklet.addModule as jest.Mock).mockRejectedValueOnce(new Error('404'));
    const limiter = createMasterLimiter(audioCtx);
    await flush();
    expect(limiter.$status.value).toBe('failed');
    expect(error).toHaveBeenCalledWith('The limiter worklet failed', expect.any(Error));
    expect(lastTarget(limiter.input)).toBe(limiter.compressor);
    error.mockRestore();
  });

  it('goes back to the compressor when the processor fails', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { limiter, statuses, worklet } = setup();
    await flush();
    const { node } = worklet();
    node.onprocessorerror?.call(node, new Event('processorerror'));
    expect(statuses).toEqual(['loading', 'ready', 'failed']);
    expect(lastTarget(limiter.input)).toBe(limiter.compressor);
    error.mockRestore();
  });

  it('destroy stops the processor and disconnects everything', async () => {
    const { limiter, worklet } = setup();
    await flush();
    const { node } = worklet();
    const connects = (limiter.input.connect as jest.Mock).mock.calls.length;
    limiter.destroy();
    expect(node.port.postMessage).toHaveBeenCalledWith({ stop: true });
    [limiter.input, limiter.compressor, limiter.compensation, limiter.output, node].forEach((audioNode) =>
      expect(audioNode.disconnect).toHaveBeenCalled()
    );
    expect(limiter.$status.isStopped).toBe(true);
    expect(limiter.input.connect).toHaveBeenCalledTimes(connects);
  });

  describe('the fallback compressor', () => {
    it('is a hard knee with a release that does not follow the wave', () => {
      const { limiter } = setup();
      const { compressor } = limiter;
      expect(compressor.threshold.setValueAtTime).toHaveBeenCalledWith(-4, 0);
      expect(compressor.knee.setValueAtTime).toHaveBeenCalledWith(0, 0);
      expect(compressor.ratio.setValueAtTime).toHaveBeenCalledWith(20, 0);
      expect(compressor.attack.setValueAtTime).toHaveBeenCalledWith(0.001, 0);
      expect(compressor.release.setValueAtTime).toHaveBeenCalledWith(0.25, 0);
      expect(compressor.threshold.value).toBe(FALLBACK_LIMITER.threshold);
      expect(compressor.release.value).toBe(FALLBACK_LIMITER.release);
    });

    it('its makeup gain is taken back (-2.28 dB)', () => {
      const { limiter } = setup();
      expect(limiter.compensation.gain.value).toBeCloseTo(0.7691, 4);
    });

    it('passes the sound below the threshold at unity', () => {
      const { limiter } = setup();
      [-40, -12, -4.5].forEach((input) =>
        expect(compressed(input) + db(limiter.compensation.gain.value)).toBeCloseTo(input, 6)
      );
    });

    // the room for the overshoot of the compressor on dense unison chords struck at once
    // (in Chrome ~2.5 dB at a 5 ms attack, ~4 dB at attack 0)
    it('keeps a sound 20 dB over full scale 2.8 dB below 0 dBFS', () => {
      const { limiter } = setup();
      expect(compressed(20) + db(limiter.compensation.gain.value)).toBeCloseTo(-2.8, 6);
      // without taking back the makeup gain it would be 2.3 dB louder, the overshoot would clip
      expect(compressed(20)).toBeGreaterThan(-1);
    });
  });

  describe('compressorMakeupGain', () => {
    it('is +3.42 dB for a threshold of -6 dB at ratio 20', () => {
      expect(db(compressorMakeupGain({ threshold: -6, ratio: 20 }))).toBeCloseTo(3.42, 2);
    });

    it('is unity for a threshold of 0 dB or a ratio of 1', () => {
      expect(compressorMakeupGain({ threshold: 0, ratio: 20 })).toBe(1);
      expect(compressorMakeupGain({ threshold: -12, ratio: 1 })).toBe(1);
    });

    // the spec: makeup = (1 / curve(1.0))^0.6
    it('is the inverse of the curve at full scale to the power 0.6', () => {
      [
        [-6, 20],
        [-3, 12],
        [-24, 4],
      ].forEach(([threshold, ratio]) => {
        expect(db(compressorMakeupGain({ threshold, ratio }))).toBeCloseTo(
          -0.6 * curve(0, threshold, ratio),
          10
        );
      });
    });
  });
});
