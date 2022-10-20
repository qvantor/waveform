import React from 'react';
import { createRxModule, useNullableContext } from '@waveform/rxjs';
import { BehaviorSubject } from 'rxjs';

export const audioProcessorModule = () =>
  createRxModule({
    createContext: () => {
      const audioCtx = new window.AudioContext();
      const oscillator = audioCtx.createOscillator();
      const analyser = audioCtx.createAnalyser();
      analyser.connect(audioCtx.destination);
      oscillator.start();

      const $isPlay = new BehaviorSubject<boolean>(false);
      const $frequency = new BehaviorSubject<number>(100);

      return { audioCtx, oscillator, analyser, $frequency, $isPlay };
    },
    actions: ({ oscillator, audioCtx, $isPlay, $frequency, analyser }) => ({
      setWave: (value: [number[], number[]]) =>
        oscillator.setPeriodicWave(audioCtx.createPeriodicWave(...value)),

      setFrequency: (fq: number) => $frequency.next(fq),
      play: () => oscillator.connect(analyser),
      stop: () => oscillator.disconnect(),
      playToggle: () => $isPlay.next(!$isPlay.value),
    }),
    subscriptions: ({ $isPlay, $frequency, oscillator, audioCtx }, { play, stop }) => [
      $isPlay.subscribe((isPlay) => (isPlay ? play() : stop())),
      $frequency.subscribe((fq) => oscillator.frequency.setValueAtTime(fq, audioCtx.currentTime)),
    ],
  });

export type AudioProcessorModule = ReturnType<typeof audioProcessorModule>;

export const AudioProcessorContext = React.createContext<AudioProcessorModule | null>(null);

export const useAudioProcessorContext = () =>
  useNullableContext(AudioProcessorContext, 'useAudioProcessorContext');
