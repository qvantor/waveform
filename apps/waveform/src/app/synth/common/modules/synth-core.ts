import { PrimitiveBS, ArrayBS, rxModel, rxModelReact } from '@waveform/rxjs-react';

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

    masterLimiter.connect(masterGain);
    masterGain.connect(audioCtx.destination);

    const $masterGain = new PrimitiveBS<number>(0.8);
    const $limiter = new PrimitiveBS<boolean>(false);
    const $midNodes = new ArrayBS<AudioNode[]>([]); // nodes to connect between preGain and masterLimiter

    return { audioCtx, preGain, masterLimiter, masterGain, $midNodes, $masterGain, $limiter };
  })
    .actions(({ $masterGain, $midNodes }) => ({
      setMasterGain: (value: number) => $masterGain.next(value),
      addMidNode: (node: AudioNode) => $midNodes.next([...$midNodes.value, node]),
      removeMidNode: (node: AudioNode) => {
        node.disconnect();
        $midNodes.next($midNodes.value.filter((midNode) => midNode !== node));
      },
    }))
    .subscriptions(({ $masterGain, $midNodes, audioCtx, masterGain, preGain, masterLimiter }) => [
      $masterGain.subscribe((value) => masterGain.gain.setValueAtTime(value, audioCtx.currentTime)),
      $midNodes.subscribe((nodes) => {
        preGain.disconnect();
        if (nodes.length > 0) {
          for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            const next = nodes[i + 1];
            if (i === 0) preGain.connect(node);
            if (next) node.connect(next);
            else node.connect(masterLimiter);
          }
        } else {
          preGain.connect(masterLimiter);
        }
      }),
    ]);

export const { ModelProvider: SynthCoreProvider, useModel: useSynthCore } = rxModelReact(
  'synthCore',
  synthCore
);

export type SynthCoreModule = ReturnType<typeof useSynthCore>;
export type SynthCoreModel = SynthCoreModule[0];
export type SynthCoreActions = SynthCoreModule[1];
