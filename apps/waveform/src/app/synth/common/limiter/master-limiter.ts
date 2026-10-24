import { createWorkletFx, STEREO_WORKLET_OPTIONS } from '../../fx/effects/worklet-fx';
import { LIMITER_PROCESSOR } from '../processors';

// the last stage of the synth, after the master volume: input → the limiter worklet → output once its module
// has loaded (createWorkletFx). Until then, and after the module or the processor failed, the master is
// silent: the oscillators need the same (AudioWorklet, wasm SIMD), LimiterStatus shows a failed limiter (a toast
// on every screen), its Retry loads it again
export const createMasterLimiter = (audioCtx: BaseAudioContext) =>
  createWorkletFx(
    audioCtx,
    'limiter',
    () => new AudioWorkletNode(audioCtx, LIMITER_PROCESSOR, STEREO_WORKLET_OPTIONS)
  );
