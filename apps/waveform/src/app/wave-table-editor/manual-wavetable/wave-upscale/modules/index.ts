import { distinctUntilChanged, filter, map, mergeWith } from 'rxjs';
import { rxModel, rxModelReact, ArrayBS, PrimitiveBS } from '@waveform/rxjs-react';
import { number, wave } from '@waveform/math';
import { appSnapshotPlugin } from '../../../../app';
import { AudioProcessorModule } from '../../../common/modules';
import { ManualWavetableModule } from '../../modules';

interface Dependencies {
  audioProcessor: AudioProcessorModule;
  manualWavetable: ManualWavetableModule;
}

const waveUpscale = ({
  audioProcessor: [, { setWave }],
  manualWavetable: [{ $rate, $wave }],
}: Dependencies) =>
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
          map(wave.realWithImag)
        )
        .subscribe($outputWave),
      $outputWave.subscribe(setWave),
    ])
    .plugins(appSnapshotPlugin());

export const { ModelProvider: WaveUpscaleProvider, useModel: useWaveUpscale } = rxModelReact(
  'waveUpscale',
  waveUpscale
);
