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

// the last stage, after the master volume: a hard knee keeps the peaks below 0 dBFS. The compressor overshoots
// its curve on the onset of dense unison chords struck at once (in Chrome ~2.5 dB at a 5 ms attack, ~4 dB at
// attack 0); at master 100% and a 5 ms attack -4 still stays under 0 dBFS (-3.5 doesn't). The first ms of such
// a chord can go over at master above 100% (+0.2 dB) or at attack 0 (up to +1.8 dB). The release is long enough
// not to follow the wave (a short one moves the gain every cycle: grit)
export const LIMITER = { threshold: -4, knee: 0, ratio: 20, attack: 0.001, release: 0.25 };

// the makeup gain a DynamicsCompressorNode adds by spec: (1 / curve(1))^0.6, for a hard knee
// curve(1) is threshold · (1 - 1/ratio) dB
export const limiterMakeupGain = ({ threshold, ratio }: { threshold: number; ratio: number }) =>
  10 ** ((-0.6 * threshold * (1 - 1 / ratio)) / 20);

export const synthCore = () =>
  rxModel(() => {
    const audioCtx = new AudioContext();
    const preGain = audioCtx.createGain();
    const masterGain = audioCtx.createGain();
    const masterLimiter = audioCtx.createDynamicsCompressor();
    // takes back the makeup gain of the limiter, so below its threshold the sound passes at unity;
    // the analysers tap it, they show what is played
    const output = audioCtx.createGain();
    // the fx chain is wired between these two by the fx model, after the mid nodes (filter)
    const fxIn = audioCtx.createGain();
    const fxOut = audioCtx.createGain();

    preGain.gain.setValueAtTime(1, audioCtx.currentTime);

    masterLimiter.threshold.setValueAtTime(LIMITER.threshold, audioCtx.currentTime);
    masterLimiter.knee.setValueAtTime(LIMITER.knee, audioCtx.currentTime);
    masterLimiter.ratio.setValueAtTime(LIMITER.ratio, audioCtx.currentTime);
    masterLimiter.attack.setValueAtTime(LIMITER.attack, audioCtx.currentTime);
    masterLimiter.release.setValueAtTime(LIMITER.release, audioCtx.currentTime);
    output.gain.setValueAtTime(1 / limiterMakeupGain(LIMITER), audioCtx.currentTime);

    fxIn.connect(fxOut);
    fxOut.connect(masterGain);
    masterGain.connect(masterLimiter);
    masterLimiter.connect(output);
    output.connect(audioCtx.destination);

    const $masterGain = new PrimitiveBS<number>(1);
    const $midNodes = new ArrayBS<AudioNode[]>([]); // nodes to connect between preGain and fxIn

    return { audioCtx, preGain, fxIn, fxOut, masterLimiter, masterGain, output, $midNodes, $masterGain };
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
        const chain = [preGain, ...nodes, fxIn];
        for (let i = 0; i < chain.length - 1; i++) chain[i].connect(chain[i + 1]);
      }),
    ]);

export const { ModelProvider: SynthCoreProvider, useModel: useSynthCore } = rxModelReact(
  'synthCore',
  synthCore
);

export type SynthCoreModule = ReturnType<typeof useSynthCore>;
