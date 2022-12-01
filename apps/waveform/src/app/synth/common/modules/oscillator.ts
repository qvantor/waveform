import { map, mergeMap, mergeWith, BehaviorSubject } from 'rxjs';
import { ObjectBS, rxModel, rxModelReact, PrimitiveBS } from '@waveform/rxjs-react';
import { generateId, Vector2D, wave } from '@waveform/math';
import { appSnapshotPlugin } from '../../../app';
import { SynthCoreModule } from './synth-core';

interface Dependencies {
  synthCore: SynthCoreModule;
}

// @todo AudioContext should be used as dep
export const oscillator = ({ synthCore: [{ audioCtx }] }: Dependencies) =>
  rxModel(({ active }: { active: boolean }) => {
    const id = generateId();
    const gainNode = audioCtx.createGain();
    const ranges: Record<'unison' | 'detune' | 'randPhase' | 'octave', Vector2D> = {
      unison: [1, 8],
      detune: [0, 100],
      randPhase: [0, 0.002],
      octave: [-3, 3],
    };
    const $active = new PrimitiveBS<boolean>(active);
    const $osc = new ObjectBS({
      unison: 2,
      detune: 5,
      randPhase: 0,
      octave: 0,
    });
    const $waveTable = new BehaviorSubject<BehaviorSubject<number[]>[]>([new BehaviorSubject([0, 1])]);
    const $current = new PrimitiveBS<number>(0);
    const $periodicWave = new BehaviorSubject<PeriodicWave>(audioCtx.createPeriodicWave([0, 1], [0, 1]));
    const $wave = $current.pipe(
      mergeWith($waveTable),
      mergeMap(() => $waveTable.value[$current.value])
    );
    const $gain = new PrimitiveBS<number>(0.5);

    return {
      id,
      gainNode,
      ranges,
      $active,
      $waveTable,
      $current,
      $osc,
      $wave,
      $periodicWave,
      $gain,
    };
  })
    .actions(({ $osc, $current, $active, $gain, $waveTable }) => ({
      setOscValue: (key: keyof typeof $osc.value, value: number) =>
        $osc.next({
          ...$osc.value,
          [key]: value,
        }),
      setCurrent: (i: number) => $current.next(i),
      toggleActive: () => $active.next(!$active.value),
      setGain: (value: number) => $gain.next(value),
      setWaveTable: (wavetable: number[][]) => {
        $current.next(0);
        $waveTable.next(wavetable.map((value) => new BehaviorSubject(value)));
      },
    }))
    .subscriptions(({ $wave, $periodicWave, $gain, gainNode }) => [
      $wave
        .pipe(
          map(wave.realWithImag),
          map((value) => audioCtx.createPeriodicWave(...value))
        )
        .subscribe($periodicWave),
      $gain.subscribe((value) => gainNode.gain.setValueAtTime(value, audioCtx.currentTime)),
    ])
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
