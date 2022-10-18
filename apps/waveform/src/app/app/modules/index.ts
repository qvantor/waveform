import { mergeWith, map, filter, distinctUntilChanged, BehaviorSubject, fromEvent } from 'rxjs';
import { createRxModule } from '@waveform/rxjs';
import { number } from '@waveform/math';
import { Wave } from '../../wave-editor/common';
import { OutputWave } from '../../output-wave/common';
import FFT from 'fft.js';

const audioModule = () => {
  const audioCtx = new window.AudioContext();
  const oscillator = audioCtx.createOscillator();
  const analyser = audioCtx.createAnalyser();
  analyser.connect(audioCtx.destination);
  oscillator.start();

  const setFrequency = (value: number) => oscillator.frequency.setValueAtTime(value, audioCtx.currentTime);
  const setWave = (value: [number[], number[]]) =>
    oscillator.setPeriodicWave(audioCtx.createPeriodicWave(...value));

  const play = () => {
    oscillator.connect(analyser);
  };
  const stop = () => {
    oscillator.disconnect();
  };

  return { audioCtx, analyser, setFrequency, setWave, play, stop };
};

export const appModule = () =>
  createRxModule({
    createContext: () => {
      const { analyser, setFrequency, setWave, play, stop } = audioModule();

      const maxRate = 7;
      const $keyUp = fromEvent<KeyboardEvent>(document, 'keyup');
      const $play = new BehaviorSubject<boolean>(false);
      const $rate = new BehaviorSubject<number>(4);
      const $frequency = new BehaviorSubject<number>(100);
      const $phase = new BehaviorSubject<number>(0);
      const $wave = new Wave(Array(number.powerOfTwo(maxRate)).fill(0));
      const $outputRate = new BehaviorSubject<number>(10);
      const $outputWave = new OutputWave([[], []]);
      return {
        $keyUp,
        $play,
        $wave,
        $rate,
        $outputRate,
        $outputWave,
        $phase,
        $frequency,
        maxRate,
        analyser,
        setFrequency,
        setWave,
        play,
        stop,
      };
    },
    subscriptions: ({
      $keyUp,
      $play,
      $wave,
      $rate,
      $outputRate,
      $outputWave,
      $phase,
      $frequency,
      setFrequency,
      setWave,
      play,
      stop,
    }) => [
      $wave
        .pipe(
          mergeWith($rate, $outputRate, $phase),
          distinctUntilChanged(),
          map(() => [...$wave.value].splice(0, number.powerOfTwo($rate.value))),
          map((croppedWave): number[] => {
            if ($rate.value >= $outputRate.value) return croppedWave;
            const fArray = [];
            for (let i = 0; i < croppedWave.length; i++) {
              const from = croppedWave[i];
              const to = croppedWave[i + 1] ?? croppedWave[0];
              const stepsCount = number.powerOfTwo($outputRate.value) / number.powerOfTwo($rate.value);
              const diff = to - from;
              const stepDiff = diff / stepsCount;
              for (let j = 0; j < stepsCount; j++) {
                fArray.push(from + stepDiff * j);
              }
            }

            return [...fArray.splice(Math.round(($phase.value / 100) * fArray.length)), ...fArray];
          }),
          map((real): [number[], number[]] => {
            const f = new FFT(real.length);
            const imag = new Array(real.length);
            f.realTransform(imag, real);

            const imagOutput: number[] = [];
            for (let i = 0; i < imag.length; i++) {
              if (i % 2 === 0) continue;
              imagOutput.push(imag[i]);
            }
            return [real, imagOutput];
          })
        )
        .subscribe($outputWave),
      $rate.pipe(filter((rate) => rate > $outputRate.value)).subscribe($outputRate),
      $outputWave.subscribe(setWave),
      $frequency.subscribe(setFrequency),
      $play.subscribe((value) => (value ? play() : stop())),
      $keyUp.pipe(filter((e) => e.code === 'Space')).subscribe(() => $play.next(!$play.value)),
    ],
  });
