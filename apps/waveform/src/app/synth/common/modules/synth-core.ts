import { fromEvent, merge } from 'rxjs';
import { PrimitiveBS, rxModel, rxModelReact } from '@waveform/rxjs-react';
import { underrunEvents, watchDropouts } from '../latency/dropouts';
import { keepNormalLatency, LATENCY_HINTS, readLatencyMode, resolveLatency } from '../latency/latency';
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
    // null: the browser picks its own (latency.ts)
    const latency = resolveLatency();
    const audioCtx = new AudioContext(latency ? { latencyHint: LATENCY_HINTS[latency] } : undefined);
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
    // at low latency: the dropouts of the context so far (null: at normal, or the browser counts none), and
    // whether there were too many for this machine (the settings offer normal then)
    const $dropouts = new PrimitiveBS<number | null>(latency === 'low' ? underrunEvents(audioCtx) : null);
    const $dropoutWarning = new PrimitiveBS<boolean>(false);
    // the output silenced by a preset switch, from its mute to its unmute
    const $muted = new PrimitiveBS<boolean>(false);

    return {
      audioCtx,
      $dropouts,
      $dropoutWarning,
      $muted,
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
    .actions(({ $masterGain, $dropoutWarning, $muted, audioCtx, fxOut, wavetables, masterLimiter }) => {
      const open = (now: number) => {
        fxOut.gain.cancelScheduledValues(now);
        fxOut.gain.setValueAtTime(1, now);
      };
      return {
        setMasterGain: (value: number) => $masterGain.next(value),
        // a preset switch (soundSwitch) silences the output after the tails of the fx (fxOut: nothing else
        // automates it): it fades out in `seconds` from now, then opens again at once
        mute: (seconds: number) => {
          const now = audioCtx.currentTime;
          open(now);
          fxOut.gain.linearRampToValueAtTime(0, now + seconds);
          $muted.next(true);
        },
        unmute: () => {
          open(audioCtx.currentTime);
          $muted.next(false);
        },
        // the user answered the warning (it isn't shown again)
        dismissDropoutWarning: () => $dropoutWarning.next(false),
        // loads again the oscillators and the limiter that failed (each only then): one Retry brings the sound
        // back when both did (the network down at the start)
        retryAudio: () => {
          wavetables.retry();
          masterLimiter.retry();
        },
      };
    })
    .subscriptions(({ $masterGain, $dropouts, $dropoutWarning, $muted, audioCtx, masterGain }) => [
      resumeOnGesture(audioCtx),
      $masterGain.subscribe((value) => masterGain.gain.setValueAtTime(value, audioCtx.currentTime)),
      // too many dropouts at low: auto keeps normal from the next start on (those of a preset switch aren't
      // counted)
      ...($dropouts.value === null
        ? []
        : [
            watchDropouts(
              audioCtx,
              $muted,
              (count) => $dropouts.next(count),
              () => {
                if (readLatencyMode() === 'auto') keepNormalLatency();
                $dropoutWarning.next(true);
              }
            ),
          ]),
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
