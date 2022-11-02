import { map, mergeMap, mergeWith, BehaviorSubject } from 'rxjs';
import { ObjectBS, ArrayBS, rxModel, rxModelReact, PrimitiveBS } from '@waveform/rxjs-react';
import { number, wave } from '@waveform/math';
import { appSnapshotPlugin } from '../../../app';

// @todo AudioContext should be used as dep
export const oscillator = () =>
  rxModel(() => {
    const audioCtx = new AudioContext();
    const ranges = {
      unison: [1, 8],
      detune: [0, 100],
      randPhase: [0, 0.002],
    };
    const $active = new PrimitiveBS<boolean>(true);
    const $osc = new ObjectBS({
      unison: 4,
      detune: 30,
      randPhase: 0.001,
    });
    const $waveTable = new ArrayBS<ArrayBS<number[]>[]>([new ArrayBS(Array(number.powerOfTwo(12)).fill(0))]);
    const $current = new PrimitiveBS<number>(0);
    const $periodicWave = new BehaviorSubject<PeriodicWave>(audioCtx.createPeriodicWave([0, 1], [0, 1]));
    const $wave = $current.pipe(
      mergeWith($waveTable),
      mergeMap(() => $waveTable.value[$current.value])
    );

    return {
      audioCtx,
      ranges,
      $active,
      $waveTable,
      $current,
      $osc,
      $wave,
      $periodicWave,
    };
  })
    .actions(({ $osc, $current, $active }) => ({
      setOscValue: (key: keyof typeof $osc.value, value: number) =>
        $osc.next({
          ...$osc.value,
          [key]: value,
        }),
      setCurrent: (i: number) => $current.next(i),
      toggleActive: () => $active.next(!$active.value),
    }))
    .subscriptions(({ $wave, $periodicWave, audioCtx }) =>
      $wave
        .pipe(
          map(wave.realWithImag),
          map((value) => audioCtx.createPeriodicWave(...value))
        )
        .subscribe($periodicWave)
    )
    .plugins(appSnapshotPlugin());

export const { ModelProvider: Oscillator1Provider, useModel: useOscillator1 } = rxModelReact(
  'oscillator1',
  oscillator
);

export const { ModelProvider: Oscillator2Provider, useModel: useOscillator2 } = rxModelReact(
  'oscillator2',
  oscillator
);

export type OscillatorModule = ReturnType<typeof useOscillator1>;
export type OscillatorModel = OscillatorModule[0];
export type OscillatorActions = OscillatorModule[1];
