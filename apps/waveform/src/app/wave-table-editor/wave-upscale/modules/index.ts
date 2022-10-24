import { distinctUntilChanged, filter, map, mergeWith } from 'rxjs';
import { rxModel, rxModelReact, ArrayBS, PrimitiveBS } from '@waveform/rxjs-react';
import { WaveTableModel } from '../../wave-table';
import { number } from '@waveform/math';
import { AudioProcessorModel } from '../../wave-table-editor';
import FFT from 'fft.js';

interface Dependencies {
  audioProcessor: AudioProcessorModel;
  waveTable: WaveTableModel;
}

const waveUpscale = ({ audioProcessor: [, { setWave }], waveTable: [{ $rate, $wave }] }: Dependencies) =>
  rxModel(() => {
    const $inputWave = new ArrayBS<number[]>([]);
    const $outputRate = new PrimitiveBS<number>(10);
    const $outputWave = new ArrayBS<[number[], number[]]>([[], []]);
    const $phase = new PrimitiveBS<number>(0);
    return { $outputRate, $outputWave, $inputWave, $phase };
  })
    .actions(({ $outputRate, $phase }) => ({
      setOutputRate: (value: number) => $outputRate.next(value),
      setPhase: (value: number) => $phase.next(value),
    }))
    .subscriptions(({ $inputWave, $outputRate, $phase, $outputWave }) => [
      $wave.subscribe($inputWave),
      $rate.pipe(filter((rate) => rate > $outputRate.value)).subscribe($outputRate),
      $inputWave
        .pipe(
          mergeWith($rate, $outputRate, $phase),
          distinctUntilChanged(),
          map(() => [...$inputWave.value].splice(0, number.powerOfTwo($rate.value))),
          map((croppedWave): number[] => {
            if ($rate.value >= $outputRate.value) return croppedWave;
            const fArray = [];
            for (let i = 0; i < number.powerOfTwo($rate.value); i++) {
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
      $outputWave.subscribe(setWave),
    ]);

export const { ModelProvider: WaveUpscaleProvider, useModel: useWaveUpscale } = rxModelReact(
  'waveUpscale',
  waveUpscale
);

export type WaveUpscaleModel = ReturnType<typeof useWaveUpscale>;
