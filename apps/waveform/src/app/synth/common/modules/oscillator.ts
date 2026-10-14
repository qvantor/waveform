import {
  map,
  mergeMap,
  mergeWith,
  BehaviorSubject,
  filter,
  switchMap,
  defer,
  retry,
  catchError,
  of,
} from 'rxjs';
import { ObjectBS, rxModel, rxModelReact, PrimitiveBS, ArrayBS } from '@waveform/rxjs-react';
import { generateId, Vector2D, wave } from '@waveform/math';
import { urlSnapshotPlugin } from '../../../app';
import { loadWavetable, LoadWavetable, wavetableId } from '../../services';
import { SynthCoreModule } from './synth-core';

// one sine cycle, played until a table loads (a wave of 2 samples has no harmonics)
const PLACEHOLDER_WAVE = [0, 1, 0, -1];

interface Dependencies {
  synthCore: SynthCoreModule;
  loadWavetable?: LoadWavetable;
}

// @todo AudioContext should be used as dep
export const oscillator = ({
  synthCore: [{ audioCtx }],
  loadWavetable: load = loadWavetable,
}: Dependencies) =>
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
    const $waveTable = new BehaviorSubject<BehaviorSubject<number[]>[]>([
      new BehaviorSubject(PLACEHOLDER_WAVE),
    ]);
    const $current = new PrimitiveBS<number>(0);
    const $periodicWave = new BehaviorSubject<PeriodicWave>(audioCtx.createPeriodicWave([0, 1], [0, 1]));
    const $wave = $current.pipe(
      mergeWith($waveTable),
      mergeMap(() => $waveTable.value[$current.value] ?? new BehaviorSubject(PLACEHOLDER_WAVE))
    );
    const $gain = new PrimitiveBS<number>(0.5);
    const $waveTableLoading = new PrimitiveBS<boolean>(false);

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
      $waveTableLoading,
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
        if (wavetable.length <= $current.value) $current.next(wavetable.length - 1);
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
    // the table follows the path (also from presets) whatever screen is shown
    .subscriptions(({ $waveTablePath, $waveTableLoading }, { setWaveTable }) => {
      // the table loaded or loading: the same path again keeps edited waves; cleared on a failure to load it again
      let tableId = '';
      return $waveTablePath
        .pipe(
          map(wavetableId),
          filter((id) => id !== '' && id !== tableId),
          // a newer path cancels the pending load, so a slower response can't overwrite its table
          switchMap((id) => {
            tableId = id;
            $waveTableLoading.next(true);
            return defer(() => load(audioCtx, id)).pipe(
              retry({ count: 2, delay: 1000 }),
              catchError((error) => {
                console.error(`Failed to load the wavetable ${id}`, error);
                tableId = '';
                return of(null);
              })
            );
          })
        )
        .subscribe((wavetable) => {
          if (wavetable) setWaveTable(wavetable);
          $waveTableLoading.next(false);
        });
    })
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
            g: model.$gain.value,
          };
        },
        applySnap: (snap, model) => {
          snap.a !== undefined && model.$active.next(snap.a);
          snap.p !== undefined && model.$waveTablePath.next(snap.p);
          snap.w !== undefined && model.$current.next(snap.w);
          snap.g !== undefined && model.$gain.next(snap.g);
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
