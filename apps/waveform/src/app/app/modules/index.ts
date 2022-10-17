import { mergeWith, map, debounce, interval, filter, skip } from 'rxjs';
import { createRxModule } from '@waveform/rxjs';
import { number } from '@waveform/math';
import { Wave, Rate } from '../../wave-editor/common';
import { OutputWave } from '../../output-wave/common';
import { fft } from 'fft-js';

export const appModule = () =>
  createRxModule({
    createContext: () => {
      const audioCtx = new window.AudioContext();
      const oscillator = audioCtx.createOscillator();
      const analyser = audioCtx.createAnalyser();

      oscillator.frequency.setValueAtTime(100, audioCtx.currentTime);
      oscillator.connect(analyser);
      analyser.connect(audioCtx.destination);
      oscillator.start();

      const maxRate = 7;
      const $rate = new Rate(4);
      const $wave = new Wave(Array(number.powerOfTwo(maxRate)).fill(0));
      const $outputRate = new Rate(10);
      const $outputWave = new OutputWave([[], []]);
      return { $wave, $rate, $outputRate, $outputWave, maxRate, audioCtx, oscillator, analyser };
    },
    subscriptions: ({ $wave, $rate, $outputRate, $outputWave, audioCtx, oscillator }) => [
      $wave
        .pipe(
          mergeWith($rate, $outputRate),
          debounce(() => interval(32)),
          map(() => [...$wave.value].splice(0, number.powerOfTwo($rate.value))),
          map((croppedWave): number[] =>
            croppedWave
              .map((from, index) => {
                const to = croppedWave[index + 1] ?? croppedWave[0];
                const stepsCount = number.powerOfTwo($outputRate.value) / number.powerOfTwo($rate.value);
                const diff = to - from;
                const stepDiff = diff / stepsCount;
                return [...Array(stepsCount)].map((_, i) => from + stepDiff * i);
              })
              .flat()
          ),
          map((real): [number[], number[]] => {
            const waveFFT = fft(real);
            const imag = waveFFT.map((item) => item[1]);
            return [real, imag];
          })
        )
        .subscribe($outputWave),
      $rate.pipe(filter((rate) => rate > $outputRate.value)).subscribe($outputRate),
      $outputWave.pipe(skip(1)).subscribe(([real, imag]) => {
        const wave = audioCtx.createPeriodicWave(real, imag);
        oscillator.setPeriodicWave(wave);
      }),
    ],
  });
