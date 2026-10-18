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
  combineLatest,
  throttleTime,
  asyncScheduler,
} from 'rxjs';
import { ObjectBS, rxModel, rxModelReact, PrimitiveBS, ArrayBS } from '@waveform/rxjs-react';
import { DEFAULT_PHASE, withLegacyPhase } from '@waveform/preset-schema';
import { generateId, Vector2D } from '@waveform/math';
import { urlSnapshotPlugin } from '../../../app';
import { loadWavetable, LoadWavetable, wavetableId } from '../../services';
import { OSC_PARAMS, OscParam } from '../wavetable/wavetable-osc-params';
import { SynthCoreModule } from './synth-core';

// one sine cycle, played until a table loads (a wave of 2 samples has no harmonics)
const PLACEHOLDER_WAVE = [0, 1, 0, -1];
// ms between two versions of an edited table at most: an edit rebuilds the whole table in the worker
export const TABLE_THROTTLE = 100;

interface Dependencies {
  synthCore: SynthCoreModule;
  loadWavetable?: LoadWavetable;
}

// the frame of a position (the knob), for the editors of the table
export const frameIndex = (position: number) => Math.round(position);

// the base of the params of the oscillator on a voice node (wavetable-osc-params.ts), from the knobs: the
// position as a share of the table, the octave in cents (the pitch of a voice is the note's), the unison detune
// as its spread (cents), the gain
const baseParams = (position: number, frames: number, octave: number, detune: number, gain: number) => ({
  position: frames > 1 ? Math.min(1, Math.max(0, position / (frames - 1))) : 0,
  detune: 1200 * octave,
  spread: detune,
  gain,
});

export const oscillator = ({
  synthCore: [{ audioCtx, wavetables }],
  loadWavetable: load = loadWavetable,
}: Dependencies) =>
  rxModel(({ active, initialWavePath }: { active: boolean; initialWavePath: string[] }) => {
    // the id of its table in the wavetable oscillator too
    const id = generateId();
    // phase: the start of every unison voice, phaseRand: the most of its random shift (0: all in phase, 1: any
    // phase), shares of a period (the knobs show degrees and percents); read when a note is pressed, as unison
    const ranges: Record<'unison' | 'detune' | 'phase' | 'phaseRand' | 'octave', Vector2D> = {
      unison: [1, 8],
      detune: [0, 100],
      phase: [0, 1],
      phaseRand: [0, 1],
      octave: [-3, 3],
    };
    const $active = new PrimitiveBS<boolean>(active);
    const $osc = new ObjectBS({
      unison: 2,
      detune: 5,
      phase: DEFAULT_PHASE,
      phaseRand: 1,
      octave: 0,
    });
    const $waveTablePath = new ArrayBS<(string | number)[]>(initialWavePath);
    const $waveTable = new BehaviorSubject<BehaviorSubject<number[]>[]>([
      new BehaviorSubject(PLACEHOLDER_WAVE),
    ]);
    // the Wave knob: the position in frames (0..N - 1)
    const $position = new PrimitiveBS<number>(0);
    // the frame the position is on (the nearest one), the one the editors work on
    const $wave = $position.pipe(
      mergeWith($waveTable),
      mergeMap(() => $waveTable.value[frameIndex($position.value)] ?? new BehaviorSubject(PLACEHOLDER_WAVE))
    );
    // the wave the position plays: frame k and k + 1 morphed (the chart), as the voices do
    const $morphWave = combineLatest([$position, $waveTable]).pipe(
      switchMap(([position, table]) => {
        const k = Math.max(0, Math.min(Math.floor(position), table.length - 1));
        const share = position - k;
        const next = table[k + 1];
        const current = table[k] ?? new BehaviorSubject(PLACEHOLDER_WAVE);
        if (!next || share <= 0) return current;
        return combineLatest([current, next]).pipe(
          map(([a, b]) => (a.length === b.length ? a.map((value, i) => value + (b[i] - value) * share) : a))
        );
      })
    );
    const $gain = new PrimitiveBS<number>(0.5);
    const $waveTableLoading = new PrimitiveBS<boolean>(false);
    const $params = new BehaviorSubject<Record<OscParam, number>>(
      baseParams(0, 1, $osc.value.octave, $osc.value.detune, $gain.value)
    );
    // the mod buses: a global source (an LFO) plays into the bus of a param (connectBus), every voice connects
    // the bus to its param of this oscillator (added to the base, in its units: share of the table, cents,
    // linear) while a source plays into it: a param with an input, even a silent one, is computed per sample
    // by the browser (+14% CPU of a held note in Chrome)
    const buses = Object.fromEntries(OSC_PARAMS.map((param) => [param, audioCtx.createGain()])) as Record<
      OscParam,
      GainNode
    >;
    // the sources playing into each bus
    const $busSources = new BehaviorSubject<Record<OscParam, number>>({
      position: 0,
      detune: 0,
      spread: 0,
      gain: 0,
    });

    return {
      id,
      ranges,
      $active,
      $waveTable,
      $position,
      $osc,
      $wave,
      $morphWave,
      $gain,
      $params,
      buses,
      $busSources,
      $waveTablePath,
      $waveTableLoading,
    };
  })
    .actions(({ $osc, $position, $active, $gain, $waveTable, $waveTablePath, buses, $busSources }) => ({
      // a global source modulates a param of the voices of this oscillator, until disconnectBus
      connectBus: (param: OscParam, source: AudioNode) => {
        source.connect(buses[param]);
        $busSources.next({ ...$busSources.value, [param]: $busSources.value[param] + 1 });
      },
      disconnectBus: (param: OscParam, source: AudioNode) => {
        source.disconnect(buses[param]);
        $busSources.next({ ...$busSources.value, [param]: Math.max(0, $busSources.value[param] - 1) });
      },
      setOscValue: (key: keyof typeof $osc.value, value: number) =>
        $osc.next({
          ...$osc.value,
          [key]: value,
        }),
      setPosition: (position: number) => $position.next(position),
      toggleActive: () => $active.next(!$active.value),
      setGain: (value: number) => $gain.next(value),
      // a shorter table: the position is kept within it
      setWaveTable: (wavetable: number[][]) => {
        if (wavetable.length - 1 < $position.value) $position.next(Math.max(0, wavetable.length - 1));
        $waveTable.next(wavetable.map((value) => new BehaviorSubject(value)));
      },
      setWaveTablePath: (path: (string | number)[]) => $waveTablePath.next(path),
    }))
    // the table goes to the wavetable oscillator under the id of the model: a new table at once, an edited
    // frame at most every TABLE_THROTTLE ms (the last edit is sent too)
    .subscriptions(({ id, $waveTable }) =>
      $waveTable
        .pipe(
          switchMap((waves) =>
            combineLatest(waves.filter(Boolean)).pipe(
              throttleTime(TABLE_THROTTLE, asyncScheduler, { leading: true, trailing: true })
            )
          )
        )
        .subscribe((frames) => wavetables.setTable(id, frames))
    )
    // the base of the params of the voices follows the knobs and the length of the table
    .subscriptions(({ $position, $waveTable, $osc, $gain, $params }) =>
      combineLatest([$position, $waveTable, $osc, $gain])
        .pipe(
          map(([position, table, { octave, detune }, gain]) =>
            baseParams(position, table.length, octave, detune, gain)
          )
        )
        .subscribe($params)
    )
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
            return defer(() => load(id)).pipe(
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
            w: model.$position.value,

            o: model.$osc.value.octave,
            d: model.$osc.value.detune,
            u: model.$osc.value.unison,
            ph: model.$osc.value.phase,
            pr: model.$osc.value.phaseRand,
            g: model.$gain.value,
          };
        },
        // r: the Phase rand of a legacy url (seconds of a start delay), read only
        applySnap: (snap, model) => {
          const { ph, pr } = withLegacyPhase(snap);
          snap.a !== undefined && model.$active.next(snap.a);
          snap.p !== undefined && model.$waveTablePath.next(snap.p);
          snap.w !== undefined && model.$position.next(snap.w);
          snap.g !== undefined && model.$gain.next(snap.g);
          model.$osc.next({
            octave: snap.o ?? 0,
            detune: snap.d ?? 5,
            unison: snap.u ?? 2,
            phase: ph ?? DEFAULT_PHASE,
            phaseRand: pr ?? 1,
          });
        },
      })
    )
    .destroy(({ id, buses }) => {
      wavetables.removeTable(id);
      Object.values(buses).forEach((bus) => bus.disconnect());
    });

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
