import { PrimitiveBS, rxModel, rxModelReact } from '@waveform/rxjs-react';

const synthCore = () =>
  rxModel(() => {
    const audioCtx = new AudioContext();
    const preGain = audioCtx.createGain();
    const masterLimiter = audioCtx.createDynamicsCompressor();
    const masterGain = audioCtx.createGain();

    preGain.gain.setValueAtTime(1, audioCtx.currentTime);
    masterGain.gain.setValueAtTime(0.8, audioCtx.currentTime);

    masterLimiter.threshold.setValueAtTime(-16.0, audioCtx.currentTime);
    masterLimiter.ratio.setValueAtTime(20, audioCtx.currentTime);
    masterLimiter.attack.setValueAtTime(0.001, audioCtx.currentTime);
    masterLimiter.release.setValueAtTime(0.01, audioCtx.currentTime);

    preGain.connect(masterLimiter);
    masterLimiter.connect(masterGain);
    masterGain.connect(audioCtx.destination);

    const $masterGain = new PrimitiveBS<number>(0.8);
    const $limiter = new PrimitiveBS<boolean>(false);

    return { audioCtx, preGain, masterLimiter, masterGain, $masterGain, $limiter };
  })
    .actions(({ $masterGain }) => ({
      setMasterGain: (value: number) => $masterGain.next(value)
    }))
    .subscriptions(({ $masterGain, audioCtx, masterGain }) =>
      $masterGain.subscribe((value) => masterGain.gain.setValueAtTime(value, audioCtx.currentTime))
    );

export const { ModelProvider: SynthCoreProvider, useModel: useSynthCore } = rxModelReact(
  'synthCore',
  synthCore
);

export type SynthCoreModule = ReturnType<typeof useSynthCore>;
export type SynthCoreModel = SynthCoreModule[0];
export type SynthCoreActions = SynthCoreModule[1];
