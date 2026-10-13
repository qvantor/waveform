import { fromEvent, merge, pairwise, startWith } from 'rxjs';
import { PrimitiveBS, ArrayBS, rxModel, rxModelReact } from '@waveform/rxjs-react';

// browsers (iOS Safari especially) keep the context suspended until a user gesture,
// and iOS suspends/interrupts it again when the page goes to the background
const resumeOnGesture = (audioCtx: AudioContext) =>
  merge(
    fromEvent(document, 'pointerdown'),
    fromEvent(document, 'touchend'),
    fromEvent(document, 'keydown'),
    fromEvent(document, 'visibilitychange')
  ).subscribe(() => {
    if (document.visibilityState !== 'visible' || audioCtx.state === 'running') return;
    // play through the iOS silent switch (Safari 16.4+)
    const { audioSession } = navigator as Navigator & { audioSession?: { type: string } };
    if (audioSession) audioSession.type = 'playback';
    audioCtx.resume().catch(() => undefined);
  });

export const synthCore = () =>
  rxModel(() => {
    const audioCtx = new AudioContext();
    const preGain = audioCtx.createGain();
    const masterLimiter = audioCtx.createDynamicsCompressor();
    const masterGain = audioCtx.createGain();
    // the fx chain is wired between these two by the fx model, after the mid nodes (filter)
    const fxIn = audioCtx.createGain();
    const fxOut = audioCtx.createGain();

    preGain.gain.setValueAtTime(1, audioCtx.currentTime);

    masterLimiter.threshold.setValueAtTime(-16.0, audioCtx.currentTime);
    masterLimiter.ratio.setValueAtTime(20, audioCtx.currentTime);
    masterLimiter.attack.setValueAtTime(0.001, audioCtx.currentTime);
    masterLimiter.release.setValueAtTime(0.01, audioCtx.currentTime);

    fxIn.connect(fxOut);
    fxOut.connect(masterLimiter);
    masterLimiter.connect(masterGain);
    masterGain.connect(audioCtx.destination);

    const $masterGain = new PrimitiveBS<number>(0.8);
    const $limiter = new PrimitiveBS<boolean>(false);
    const $midNodes = new ArrayBS<AudioNode[]>([]); // nodes to connect between preGain and fxIn

    return { audioCtx, preGain, fxIn, fxOut, masterLimiter, masterGain, $midNodes, $masterGain, $limiter };
  })
    .actions(({ $masterGain, $midNodes }) => ({
      setMasterGain: (value: number) => $masterGain.next(value),
      addMidNode: (node: AudioNode) => {
        if (!$midNodes.value.includes(node)) $midNodes.next([...$midNodes.value, node]);
      },
      removeMidNode: (node: AudioNode) => {
        node.disconnect();
        $midNodes.next($midNodes.value.filter((midNode) => midNode !== node));
      },
    }))
    .subscriptions(({ $masterGain, $midNodes, audioCtx, masterGain, preGain, fxIn }) => [
      resumeOnGesture(audioCtx),
      $masterGain.subscribe((value) => masterGain.gain.setValueAtTime(value, audioCtx.currentTime)),
      $midNodes.pipe(startWith<AudioNode[]>([]), pairwise()).subscribe(([prev, nodes]) => {
        preGain.disconnect();
        // removed nodes are disconnected by removeMidNode, the kept ones lose their old links here
        prev.filter((node) => nodes.includes(node)).forEach((node) => node.disconnect());
        if (nodes.length > 0) {
          for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            const next = nodes[i + 1];
            if (i === 0) preGain.connect(node);
            if (next) node.connect(next);
            else node.connect(fxIn);
          }
        } else {
          preGain.connect(fxIn);
        }
      }),
    ]);

export const { ModelProvider: SynthCoreProvider, useModel: useSynthCore } = rxModelReact(
  'synthCore',
  synthCore
);

export type SynthCoreModule = ReturnType<typeof useSynthCore>;
