import { rxModel, rxModelReact } from '@waveform/rxjs-react';

const synthCore = () =>
  rxModel(() => {
    const audioCtx = new AudioContext();
    const preGain = audioCtx.createGain();
    const masterLimiter = audioCtx.createDynamicsCompressor();
    const masterGain = audioCtx.createGain();
    const analyserNode = audioCtx.createAnalyser();

    preGain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    masterGain.gain.setValueAtTime(0.8, audioCtx.currentTime);

    masterLimiter.threshold.setValueAtTime(-12.0, audioCtx.currentTime);
    masterLimiter.ratio.setValueAtTime(1.0, audioCtx.currentTime);
    masterLimiter.attack.setValueAtTime(0.0001, audioCtx.currentTime);
    masterLimiter.release.setValueAtTime(0.01, audioCtx.currentTime);

    preGain.connect(masterLimiter);
    masterLimiter.connect(masterGain);
    // preGain.connect(masterGain)
    masterGain.connect(analyserNode);
    analyserNode.connect(audioCtx.destination);

    return { audioCtx, preGain, masterLimiter, masterGain, analyserNode };
  });

export const { ModelProvider: SynthCoreProvider, useModel: useSynthCore } = rxModelReact(
  'synthCore',
  synthCore
);

export type SynthCoreModule = ReturnType<typeof useSynthCore>;
export type SynthCoreModel = SynthCoreModule[0];
export type SynthCoreActions = SynthCoreModule[1];
