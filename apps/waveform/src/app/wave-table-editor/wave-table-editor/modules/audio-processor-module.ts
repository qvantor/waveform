import { rxModel, rxModelReact, PrimitiveBS } from '@waveform/rxjs-react';

const audioProcessor = () =>
  rxModel(() => {
    const audioCtx = new window.AudioContext();
    const oscillator = audioCtx.createOscillator();
    const analyser = audioCtx.createAnalyser();
    analyser.connect(audioCtx.destination);
    oscillator.start();

    const $isPlay = new PrimitiveBS<boolean>(false);
    const $frequency = new PrimitiveBS<number>(100);
    return { audioCtx, oscillator, analyser, $frequency, $isPlay };
  })
    .actions(({ oscillator, audioCtx, $isPlay, $frequency, analyser }) => ({
      setWave: (value: [number[], number[]]) =>
        oscillator.setPeriodicWave(audioCtx.createPeriodicWave(...value)),

      setFrequency: (fq: number) => $frequency.next(fq),
      play: () => oscillator.connect(analyser),
      stop: () => oscillator.disconnect(),
      playToggle: () => $isPlay.next(!$isPlay.value),
    }))
    .subscriptions(({ $isPlay, $frequency, oscillator, audioCtx }, { play, stop }) => [
      $isPlay.subscribe((isPlay) => (isPlay ? play() : stop())),
      $frequency.subscribe((fq) => oscillator.frequency.setValueAtTime(fq, audioCtx.currentTime)),
    ]);

export const { ModelProvider: AudioProcessorProvider, useModel: useAudioProcessor } = rxModelReact(
  'audioProcessor',
  audioProcessor
);
export type AudioProcessorModel = ReturnType<typeof useAudioProcessor>
