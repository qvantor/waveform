import { map, mergeMap, mergeWith, BehaviorSubject } from 'rxjs';
import { ObjectBS, ArrayBS, rxModel, rxModelReact, PrimitiveBS } from '@waveform/rxjs-react';
import { number, wave } from '@waveform/math';
import { appSnapshotPlugin } from '../../../app';

// @todo AudioContext should be used as dep
const oscillator = () =>
  rxModel(() => {
    const audioCtx = new AudioContext();
    const ranges = {
      unison: [1, 8],
      detune: [0, 100],
      randPhase: [0, 0.005],
    };
    const $osc = new ObjectBS({
      unison: 4,
      detune: 30,
      randPhase: 0.001,
    });
    const $waveTable = new ArrayBS<ArrayBS<number[]>[]>([new ArrayBS(Array(number.powerOfTwo(5)).fill(0))]);
    const $current = new PrimitiveBS<number>(0);
    const $periodicWave = new BehaviorSubject<PeriodicWave>(audioCtx.createPeriodicWave([0, 1], [0, 1]));
    const $wave = $current.pipe(
      mergeWith($waveTable),
      mergeMap(() => $waveTable.value[$current.value])
    );

    return {
      audioCtx,
      ranges,
      $waveTable,
      $current,
      $osc,
      $wave,
      $periodicWave,
    };
  })
    .actions(({ $osc, $current }) => ({
      setOscValue: (key: keyof typeof $osc.value, value: number) =>
        $osc.next({
          ...$osc.value,
          [key]: value,
        }),
      setCurrent: (i: number) => $current.next(i),
    }))
    .subscriptions(({ $wave, $periodicWave, audioCtx }) =>
      $wave
        .pipe(
          map((croppedWave): number[] => {
            const fArray = [];
            for (let i = 0; i < number.powerOfTwo(5); i++) {
              const from = croppedWave[i];
              const to = croppedWave[i + 1] ?? croppedWave[0];
              const stepsCount = number.powerOfTwo(12) / number.powerOfTwo(5);
              const diff = to - from;
              const stepDiff = diff / stepsCount;
              for (let j = 0; j < stepsCount; j++) {
                fArray.push(from + stepDiff * j);
              }
            }
            return fArray;
          }),
          map(wave.realWithImag),
          map((value) => audioCtx.createPeriodicWave(...value))
        )
        .subscribe($periodicWave)
    )
    .plugins(appSnapshotPlugin());

export const { ModelProvider: OscillatorProvider, useModel: useOscillator } = rxModelReact(
  'oscillator',
  oscillator
);

export type OscillatorModule = ReturnType<typeof useOscillator>;
export type OscillatorModel = OscillatorModule[0];
export type OscillatorActions = OscillatorModule[1];
