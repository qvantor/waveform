import { fromEvent, merge } from 'rxjs';
import { PrimitiveBS, rxModel, rxModelReact } from '@waveform/rxjs-react';
import { createMasterLimiter } from '../limiter/master-limiter';
import { createWavetableEngine, WavetableEngineDependencies } from '../wavetable/wavetable-engine';

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

interface Dependencies {
  wavetables?: WavetableEngineDependencies;
}

export const synthCore = ({ wavetables: wavetableDependencies }: Dependencies = {}) =>
  rxModel(() => {
    const audioCtx = new AudioContext();
    const preGain = audioCtx.createGain();
    const masterGain = audioCtx.createGain();
    // the last stage, after the master volume; the analysers tap its output, they show what is played
    const masterLimiter = createMasterLimiter(audioCtx);
    const { output } = masterLimiter;
    // the fx chain is wired between these two by the fx model (the filter is in each voice)
    const fxIn = audioCtx.createGain();
    const fxOut = audioCtx.createGain();
    // the oscillators of every voice (an audio worklet), loaded at the start like the limiter
    const wavetables = createWavetableEngine(audioCtx, wavetableDependencies);

    preGain.gain.setValueAtTime(1, audioCtx.currentTime);

    preGain.connect(fxIn);
    fxIn.connect(fxOut);
    fxOut.connect(masterGain);
    masterGain.connect(masterLimiter.input);
    output.connect(audioCtx.destination);

    const $masterGain = new PrimitiveBS<number>(1);

    return {
      audioCtx,
      preGain,
      fxIn,
      fxOut,
      masterLimiter,
      masterGain,
      output,
      wavetables,
      $masterGain,
    };
  })
    .actions(({ $masterGain }) => ({
      setMasterGain: (value: number) => $masterGain.next(value),
    }))
    .subscriptions(({ $masterGain, audioCtx, masterGain }) => [
      resumeOnGesture(audioCtx),
      $masterGain.subscribe((value) => masterGain.gain.setValueAtTime(value, audioCtx.currentTime)),
    ])
    .destroy(({ masterLimiter, wavetables }) => {
      masterLimiter.destroy();
      wavetables.destroy();
    });

export const {
  ModelProvider: SynthCoreProvider,
  useModel: useSynthCore,
  Context: SynthCoreContext,
} = rxModelReact('synthCore', synthCore);

export type SynthCoreModule = ReturnType<typeof useSynthCore>;
