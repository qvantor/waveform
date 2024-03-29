import { map, mergeMap, mergeWith, BehaviorSubject } from 'rxjs';
import { ObjectBS, rxModel, rxModelReact, PrimitiveBS, ArrayBS } from '@waveform/rxjs-react';
import { generateId, Vector2D, wave } from '@waveform/math';
import { urlSnapshotPlugin } from '../../../app';
import { SynthCoreModule } from './synth-core';

interface Dependencies {
  synthCore: SynthCoreModule;
}

// @todo AudioContext should be used as dep
export const oscillator = ({ synthCore: [{ audioCtx }] }: Dependencies) =>
  rxModel(({ active, initialWavePath }: { active: boolean; initialWavePath: string[] }) => {
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
    const $waveTablePath = new ArrayBS<(string | number)[]>(initialWavePath);
    const $waveTable = new BehaviorSubject<BehaviorSubject<number[]>[]>([new BehaviorSubject([0, 1])]);
    const $current = new PrimitiveBS<number>(0);
    const $periodicWave = new BehaviorSubject<PeriodicWave>(audioCtx.createPeriodicWave([0, 1], [0, 1]));
    const $wave = $current.pipe(
      mergeWith($waveTable),
      mergeMap(() => $waveTable.value[$current.value] ?? new BehaviorSubject([0, 1]))
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
      $waveTablePath,
    };
  })
    .actions(({ $osc, $current, $active, $gain, $waveTable, $waveTablePath }) => ({
      setOscValue: (key: keyof typeof $osc.value, value: number) =>
        $osc.next({
          ...$osc.value,
          [key]: value,
        }),
      setCurrent: (i: number) => $current.next(i),
      toggleActive: () => $active.next(!$active.value),
      setGain: (value: number) => $gain.next(value),
      setWaveTable: (wavetable: number[][]) => {
        if (wavetable.length < $current.value) $current.next(wavetable.length - 1);
        $waveTable.next(wavetable.map((value) => new BehaviorSubject(value)));
      },
      setWaveTablePath: (path: (string | number)[]) => $waveTablePath.next(path),
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
    .plugins(
      urlSnapshotPlugin({
        modelToSnap: (model) => {
          return {
            a: model.$active.value,
            p: model.$waveTablePath.value.map(String),
            w: model.$current.value,

            o: model.$osc.value.octave,
            d: model.$osc.value.detune,
            u: model.$osc.value.unison,
            r: model.$osc.value.randPhase,
          };
        },
        applySnap: (snap, model) => {
          snap.a && model.$active.next(snap.a);
          snap.p && model.$waveTablePath.next(snap.p);
          snap.w && model.$current.next(snap.w);
          model.$osc.next({
            octave: snap.o ?? 0,
            detune: snap.d ?? 5,
            unison: snap.u ?? 2,
            randPhase: snap.r ?? 0,
          });
        },
      })
    );

export const { ModelProvider: Oscillator1Provider, useModel: useOscillator1 } = rxModelReact(
  'osc1',
  oscillator
);

export const { ModelProvider: Oscillator2Provider, useModel: useOscillator2 } = rxModelReact(
  'osc2',
  oscillator
);

export type OscillatorModule = ReturnType<typeof useOscillator1>;
export type OscillatorModel = OscillatorModule[0];
export type OscillatorActions = OscillatorModule[1];
