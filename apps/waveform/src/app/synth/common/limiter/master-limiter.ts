import { createWorkletFx } from '../../fx/effects/worklet-fx';
import { LIMITER_PROCESSOR, LimiterMessage } from './limiter-dsp';

// the fallback without the worklet: a DynamicsCompressor with a hard knee keeps the peaks below 0 dBFS. It
// overshoots its curve on the onset of dense unison chords struck at once (in Chrome ~2.5 dB at a 5 ms
// attack, ~4 dB at attack 0); at master 0 dB and a 5 ms attack -4 still stays under 0 dBFS (-3.5 doesn't).
// The first ms of such a chord can go over with the master above 0 dB or at attack 0. The release is long
// enough not to follow the wave (a short one moves the gain every cycle: grit)
export const FALLBACK_LIMITER = { threshold: -4, knee: 0, ratio: 20, attack: 0.001, release: 0.25 };

// the makeup gain a DynamicsCompressorNode adds by spec: (1 / curve(1))^0.6, for a hard knee
// curve(1) is threshold · (1 - 1/ratio) dB
export const compressorMakeupGain = ({ threshold, ratio }: { threshold: number; ratio: number }) =>
  10 ** ((-0.6 * threshold * (1 - 1 / ratio)) / 20);

// the last stage of the synth, after the master volume: input → the limiter worklet (limiter-dsp.ts) → output
// once its module has loaded (createWorkletFx). While it loads, without AudioWorklet (http on a LAN IP,
// old Safari) or after the module or the processor failed: input → compressor → compensation → output
export const createMasterLimiter = (audioCtx: BaseAudioContext) => {
  const input = audioCtx.createGain();
  const output = audioCtx.createGain();
  const compressor = audioCtx.createDynamicsCompressor();
  // takes back the makeup gain of the compressor, so below its threshold the sound passes at unity
  const compensation = audioCtx.createGain();
  // mono input is upmixed to both channels
  const worklet = createWorkletFx(
    audioCtx,
    'limiter',
    () =>
      new AudioWorkletNode(audioCtx, LIMITER_PROCESSOR, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
      })
  );

  const { threshold, knee, ratio, attack, release } = FALLBACK_LIMITER;
  compressor.threshold.setValueAtTime(threshold, audioCtx.currentTime);
  compressor.knee.setValueAtTime(knee, audioCtx.currentTime);
  compressor.ratio.setValueAtTime(ratio, audioCtx.currentTime);
  compressor.attack.setValueAtTime(attack, audioCtx.currentTime);
  compressor.release.setValueAtTime(release, audioCtx.currentTime);
  compensation.gain.setValueAtTime(1 / compressorMakeupGain(FALLBACK_LIMITER), audioCtx.currentTime);

  compressor.connect(compensation).connect(output);
  worklet.output.connect(output);

  const subscription = worklet.$status.subscribe((status) => {
    input.disconnect();
    input.connect(status === 'ready' ? worklet.input : compressor);
  });

  return {
    input,
    output,
    compressor,
    compensation,
    $status: worklet.$status,
    destroy: () => {
      subscription.unsubscribe();
      const stop: LimiterMessage = { stop: true };
      worklet.post(stop);
      worklet.destroy();
      [input, compressor, compensation, output].forEach((node) => node.disconnect());
    },
  };
};
