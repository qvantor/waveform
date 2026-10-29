import {
  map,
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
  distinctUntilChanged,
} from 'rxjs';
import { ObjectBS, rxModel, rxModelReact, PrimitiveBS, ArrayBS } from '@waveform/rxjs-react';
import { DEFAULT_PHASE, withLegacyPhase } from '@waveform/preset-schema';
import { generateId, Vector2D } from '@waveform/math';
import { urlSnapshotPlugin } from '../../../app';
import { loadWavetable, LoadWavetable, wavetableId } from '../../services';
import { UNISON_SHAPE, UnisonShape } from '../wavetable/voice-options';
import {
  crossfadeFrames,
  keyFrame,
  morphedFrame,
  playedFrame,
  playedFrames,
} from '../wavetable/wavetable-frames';
import { OscParam } from '../wavetable/wavetable-osc-params';
import { SynthCoreModule } from './synth-core';

// one sine cycle, played until a table loads (a wave of 2 samples has no harmonics)
const PLACEHOLDER_WAVE = [0, 1, 0, -1];
// ms between two versions of an edited table at most: an edit rebuilds the whole table in the worker
export const TABLE_THROTTLE = 100;

interface Dependencies {
  synthCore: SynthCoreModule;
  loadWavetable?: LoadWavetable;
}

// the frame of the table the editors work on at a position (of the frames played, the knob): the nearest one;
// of a table played expanded (a morph) the nearest of its own frames
export const frameIndex = (position: number, count: number, morph: boolean) => {
  const played = playedFrames(count, morph);
  const frame = played === count ? Math.round(position) : Math.round((position * (count - 1)) / (played - 1));
  return Math.max(0, Math.min(count - 1, frame));
};

// the position (of the frames played) of frame j of the table: where it plays alone
export const framePosition = (j: number, count: number, morph: boolean) =>
  playedFrames(count, morph) === count ? j : keyFrame(j, count);

// the pitch of the oscillator over the note in cents: Oct, Semi and Fine
const pitchCents = ({ octave, semi, fine }: { octave: number; semi: number; fine: number }) =>
  1200 * octave + 100 * semi + fine;

// the base of the params of the oscillator on a voice node (wavetable-osc-params.ts), from the knobs: the
// position as a share of the table, its pitch in cents (the pitch of a voice is the note's), the unison detune
// as its spread (cents), the gain
const baseParams = (position: number, frames: number, pitch: number, detune: number, gain: number) => ({
  position: frames > 1 ? Math.min(1, Math.max(0, position / (frames - 1))) : 0,
  detune: pitch,
  spread: detune,
  gain,
});

export const oscillator = ({
  synthCore: [{ wavetables }],
  loadWavetable: load = loadWavetable,
}: Dependencies) =>
  rxModel(({ active, initialWavePath }: { active: boolean; initialWavePath: string[] }) => {
    // the id of its table in the wavetable oscillator too
    const id = generateId();
    // phase: the start of every unison voice, phaseRand: the most of its random shift (0: all in phase, 1: any
    // phase), shares of a period (the knobs show degrees and percents); read when a note is pressed, as unison.
    // octave, semi, fine: the pitch over the note (octaves, semitones, cents)
    const ranges: Record<'unison' | 'detune' | 'phase' | 'phaseRand' | 'octave' | 'semi' | 'fine', Vector2D> =
      {
        unison: [1, 8],
        detune: [0, 100],
        phase: [0, 1],
        phaseRand: [0, 1],
        octave: [-3, 3],
        semi: [-12, 12],
        fine: [-100, 100],
      };
    const $active = new PrimitiveBS<boolean>(active);
    const $osc = new ObjectBS({
      unison: 2,
      detune: 5,
      phase: DEFAULT_PHASE,
      phaseRand: 1,
      octave: 0,
      semi: 0,
      fine: 0,
    });
    // how the unison voices sound (Blend, Width, Stack, the detune, the position spread): no knobs
    // and not in the snapshot yet (the specs and the perf hook set it), read when a note is pressed
    const $unisonShape = new ObjectBS<UnisonShape>(UNISON_SHAPE);
    const $waveTablePath = new ArrayBS<(string | number)[]>(initialWavePath);
    const $waveTable = new BehaviorSubject<BehaviorSubject<number[]>[]>([
      new BehaviorSubject(PLACEHOLDER_WAVE),
    ]);
    // the table plays expanded to 256 frames by crossfades (its file has a morph mark, or the editor made it:
    // wavetable-frames.ts), and the frames it plays
    const $morph = new PrimitiveBS<boolean>(false);
    const $frames = new PrimitiveBS<number>(1);
    // the Wave knob: the position in the frames played (0..$frames - 1)
    const $position = new PrimitiveBS<number>(0);
    // the frame the position is on (the nearest one), the one the editors work on: the edits of that frame only
    // (a step within it changes nothing)
    const $wave = $position.pipe(
      mergeWith($waveTable),
      map(
        () =>
          $waveTable.value[frameIndex($position.value, $waveTable.value.length, $morph.value)] ??
          new BehaviorSubject(PLACEHOLDER_WAVE)
      ),
      distinctUntilChanged(),
      switchMap((frame) => frame)
    );
    // the wave the position plays (the chart), as the voices: one frame of those played, of an expanded table the
    // crossfade of two frames of the table (the frames played of the table in hand: setWaveTable sets the morph
    // before the table, $frames follows both)
    const $playedWave = combineLatest([$position, $waveTable, $morph]).pipe(
      switchMap(([position, table, morph]) => {
        const frames = playedFrames(table.length, morph);
        const e = playedFrame(frames > 1 ? position / (frames - 1) : 0, frames);
        if (frames === table.length) return table[e] ?? new BehaviorSubject(PLACEHOLDER_WAVE);
        const { frame, share } = morphedFrame(e, table.length);
        if (share === 0) return table[frame];
        return combineLatest([table[frame], table[frame + 1]]).pipe(
          map(([a, b]) =>
            Array.from(crossfadeFrames(a, b, share, new Float64Array(Math.min(a.length, b.length))))
          )
        );
      })
    );
    const $gain = new PrimitiveBS<number>(0.5);
    const $waveTableLoading = new PrimitiveBS<boolean>(false);
    // where its table is in the wavetable oscillator (null: not sent yet); refused or failed: the version before
    // it plays (OscillatorStatus shows why, Retry sends it again)
    const $tableState = wavetables.$tables.pipe(
      map((tables) => tables[id] ?? null),
      distinctUntilChanged()
    );
    const $params = new BehaviorSubject<Record<OscParam, number>>(
      baseParams(0, 1, pitchCents($osc.value), $osc.value.detune, $gain.value)
    );
    // its notes play the table of its path: loaded and in the wavetable oscillator (stored, or refused or failed:
    // the version before plays); the table loaded goes to the oscillator before loading ends (setWaveTable sets
    // it sending), so no moment between them reads as played
    const tablePlayed = () => !$waveTableLoading.value && wavetables.$tables.value[id] !== 'sending';

    return {
      id,
      ranges,
      $active,
      $waveTable,
      $position,
      $osc,
      $unisonShape,
      $wave,
      $playedWave,
      $morph,
      $frames,
      $gain,
      $params,
      $waveTablePath,
      $waveTableLoading,
      $tableState,
      tablePlayed,
    };
  })
    .actions(({ $osc, $position, $active, $gain, $waveTable, $waveTablePath, $morph }) => ({
      setOscValue: (key: keyof typeof $osc.value, value: number) =>
        $osc.next({
          ...$osc.value,
          [key]: value,
        }),
      setPosition: (position: number) => $position.next(position),
      toggleActive: () => $active.next(!$active.value),
      setGain: (value: number) => $gain.next(value),
      // a new table (its frames played expanded with a morph); fewer frames played: the position is kept
      // within them
      setWaveTable: (wavetable: number[][], morph = false) => {
        const last = Math.max(0, playedFrames(wavetable.length, morph) - 1);
        if (last < $position.value) $position.next(last);
        $morph.next(morph);
        $waveTable.next(wavetable.map((value) => new BehaviorSubject(value)));
      },
      setWaveTablePath: (path: (string | number)[]) => $waveTablePath.next(path),
    }))
    .actions(({ $unisonShape }) => ({
      setUnisonShape: (shape: Partial<UnisonShape>) => $unisonShape.next({ ...$unisonShape.value, ...shape }),
    }))
    .actions(({ id }) => ({
      // its table sent again (refused by the store or failed to build)
      retryTable: () => wavetables.retryTable(id),
    }))
    // the table goes to the wavetable oscillator under the id of the model: a new table at once, an edited
    // frame at most every TABLE_THROTTLE ms (the last edit is sent too)
    // (its morph is set with it: setWaveTable)
    .subscriptions(({ id, $waveTable, $morph }) =>
      $waveTable
        .pipe(
          switchMap((waves) =>
            combineLatest(waves.filter(Boolean)).pipe(
              throttleTime(TABLE_THROTTLE, asyncScheduler, { leading: true, trailing: true })
            )
          )
        )
        .subscribe((frames) => wavetables.setTable(id, frames, $morph.value))
    )
    // the frames played follow the table and its morph
    .subscriptions(({ $waveTable, $morph, $frames }) =>
      combineLatest([$waveTable, $morph])
        .pipe(map(([table, morph]) => playedFrames(table.length, morph)))
        .subscribe($frames)
    )
    // the base of the params of the voices follows the knobs and the frames played
    .subscriptions(({ $position, $frames, $osc, $gain, $params }) =>
      combineLatest([$position, $frames, $osc, $gain])
        .pipe(
          map(([position, frames, osc, gain]) =>
            baseParams(position, frames, pitchCents(osc), osc.detune, gain)
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
          if (wavetable) setWaveTable(wavetable.frames, wavetable.morph);
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
            s: model.$osc.value.semi,
            f: model.$osc.value.fine,
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
            semi: snap.s ?? 0,
            fine: snap.f ?? 0,
            detune: snap.d ?? 5,
            unison: snap.u ?? 2,
            phase: ph ?? DEFAULT_PHASE,
            phaseRand: pr ?? 1,
          });
        },
      })
    )
    .destroy(({ id }) => {
      wavetables.removeTable(id);
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
