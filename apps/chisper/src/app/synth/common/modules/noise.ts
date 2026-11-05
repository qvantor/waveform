import {
  BehaviorSubject,
  catchError,
  combineLatest,
  defer,
  distinctUntilChanged,
  filter,
  map,
  of,
  retry,
  switchMap,
} from 'rxjs';
import { ArrayBS, ObjectBS, PrimitiveBS, rxModel, rxModelReact } from '@chisper/rxjs-react';
import { FINE_MAX, NOISE_DEFAULTS, NOISE_PITCH_MAX } from '@chisper/preset-schema';
import { generateId, Vector2D } from '@chisper/math';
import { urlSnapshotPlugin } from '../../../app';
import { loadNoiseSample, LoadNoiseSample, NoiseSample, wavetableId } from '../../services';
import type { VoiceNoiseKnobs, VoiceNoiseOptions } from '../wavetable/voice-options';
import { SynthCoreModule } from './synth-core';

interface Dependencies {
  synthCore: SynthCoreModule;
  loadNoiseSample?: LoadNoiseSample;
}

// the knobs of the noise: loop (false: once), Pitch Track, the start of a note and Rand (shares of the sample),
// Pitch (semitones) and Fine (cents) over the pitch of the sample, the pan (-1..1) and the level (0..1: its square
// the amplitude, on the scale of the oscillators)
export type NoiseKnobs = {
  loop: boolean;
  keytrack: boolean;
  start: number;
  rand: number;
  pitch: number;
  fine: number;
  pan: number;
  level: number;
};
export type NoiseNumeric = 'start' | 'rand' | 'pitch' | 'fine' | 'pan' | 'level';

const KNOB_DEFAULTS: NoiseKnobs = {
  loop: NOISE_DEFAULTS.lp,
  keytrack: NOISE_DEFAULTS.kt,
  start: NOISE_DEFAULTS.st,
  rand: NOISE_DEFAULTS.rd,
  pitch: NOISE_DEFAULTS.s,
  fine: NOISE_DEFAULTS.f,
  pan: NOISE_DEFAULTS.pn,
  level: NOISE_DEFAULTS.g,
};

// what a playing note follows of the knobs (a `noise` event): the level, the pan, the pitch in cents
export const noiseParams = ({ level, pan, pitch, fine }: NoiseKnobs): VoiceNoiseKnobs => ({
  level,
  pan,
  cents: 100 * pitch + fine,
});

// the noise oscillator: a sample of the bucket played in every voice with the oscillators (noise.rs of the core),
// through the filter and ENV 1. Its sample is loaded only while it is on (switched on, or a new path while on);
// it goes to the wavetable oscillator as a table of its own id, kept when switched off, removed with the model
export const noise = ({
  synthCore: [{ wavetables }],
  loadNoiseSample: load = loadNoiseSample,
}: Dependencies) =>
  rxModel(() => {
    // the id of its sample in the wavetable oscillator (a table there)
    const id = `noise-${generateId()}`;
    const ranges: Record<NoiseNumeric, Vector2D> = {
      start: [0, 1],
      rand: [0, 1],
      pitch: [-NOISE_PITCH_MAX, NOISE_PITCH_MAX],
      fine: [-FINE_MAX, FINE_MAX],
      pan: [-1, 1],
      level: [0, 1],
    };
    const $active = new PrimitiveBS<boolean>(NOISE_DEFAULTS.a);
    // the cascade path of its sample: its folder (a category), its key in the bucket
    const $samplePath = new ArrayBS<(string | number)[]>(NOISE_DEFAULTS.p);
    const $noise = new ObjectBS<NoiseKnobs>(KNOB_DEFAULTS);
    // the sample loaded (the overview draws it), loading
    const $sample = new BehaviorSubject<NoiseSample | null>(null);
    const $sampleLoading = new PrimitiveBS<boolean>(false);
    // where its sample is in the wavetable oscillator (null: not sent yet); refused or failed: the version before
    // plays (NoiseStatus shows why, Retry sends it again)
    const $sampleState = wavetables.$tables.pipe(
      map((tables) => tables[id] ?? null),
      distinctUntilChanged()
    );
    const $params = new BehaviorSubject<VoiceNoiseKnobs>(noiseParams($noise.value));
    // the key of the sample new notes play: the latest one the wavetable oscillator stored (null: none yet; one
    // still on its way, refused or failed: the one before plays). Mono keeps a voice while it is the same
    const $playedSample = new PrimitiveBS<string | null>(null);
    // its notes play the sample of its path: loaded and in the wavetable oscillator (stored, or refused or failed:
    // the version before plays)
    const samplePlayed = () => !$sampleLoading.value && wavetables.$tables.value[id] !== 'sending';
    // the noise of a note (null while off)
    const voiceNoise = (): VoiceNoiseOptions | null => {
      if (!$active.value) return null;
      const { loop, keytrack, start, rand } = $noise.value;
      return { sample: id, loop, keytrack, start, rand, ...$params.value };
    };
    return {
      id,
      ranges,
      $active,
      $samplePath,
      $noise,
      $sample,
      $sampleLoading,
      $sampleState,
      $params,
      $playedSample,
      samplePlayed,
      voiceNoise,
    };
  })
    .actions(({ $active, $samplePath, $noise, id }) => ({
      toggleActive: () => $active.next(!$active.value),
      setSamplePath: (path: (string | number)[]) => $samplePath.next(path),
      setNoiseValue: (key: NoiseNumeric, value: number) => $noise.next({ ...$noise.value, [key]: value }),
      setLoop: (loop: boolean) => $noise.next({ ...$noise.value, loop }),
      setKeytrack: (keytrack: boolean) => $noise.next({ ...$noise.value, keytrack }),
      // its sample sent again (refused by the store or failed to build)
      retrySample: () => wavetables.retryTable(id),
    }))
    // what playing notes follow
    .subscriptions(({ $noise, $params }) =>
      $noise
        .pipe(
          map(noiseParams),
          distinctUntilChanged((a, b) => a.level === b.level && a.pan === b.pan && a.cents === b.cents)
        )
        .subscribe($params)
    )
    // the sample of the path while it is on (also from presets), whatever screen is shown
    .subscriptions(({ id, $active, $samplePath, $sample, $sampleLoading, $sampleState, $playedSample }) => {
      // the sample loaded or loading: cleared on a failure, to load it again
      let sampleId = '';
      // the key of the sample last sent to the wavetable oscillator: new notes play it once it is stored
      let sent: string | null = null;
      return [
        combineLatest([$active, $samplePath])
          .pipe(
            filter(([active]) => active),
            map(([, path]) => wavetableId(path)),
            filter((key) => key !== '' && key !== sampleId),
            // a newer path cancels the pending load
            switchMap((key) => {
              sampleId = key;
              $sampleLoading.next(true);
              return defer(() => load(key)).pipe(
                map((sample) => ({ key, sample })),
                retry({ count: 2, delay: 1000 }),
                catchError((error) => {
                  console.error(`Failed to load the noise ${key}`, error);
                  sampleId = '';
                  return of(null);
                })
              );
            })
          )
          .subscribe((loaded) => {
            if (loaded) {
              // (before it is sent: an engine may store it at once)
              sent = loaded.key;
              wavetables.setSample(id, loaded.sample.channels, loaded.sample.sampleRate);
              $sample.next(loaded.sample);
            }
            $sampleLoading.next(false);
          }),
        $sampleState.pipe(filter((state) => state === 'stored')).subscribe(() => $playedSample.next(sent)),
      ];
    })
    .plugins(
      urlSnapshotPlugin({
        modelToSnap: ({ $active, $samplePath, $noise }) => ({
          a: $active.value,
          p: $samplePath.value.map(String),
          lp: $noise.value.loop,
          kt: $noise.value.keytrack,
          st: $noise.value.start,
          rd: $noise.value.rand,
          s: $noise.value.pitch,
          f: $noise.value.fine,
          pn: $noise.value.pan,
          g: $noise.value.level,
        }),
        // a missing key: its default
        applySnap: (snap, { $active, $samplePath, $noise }) => {
          const active = snap.a ?? NOISE_DEFAULTS.a;
          // switched off before its path, on after it: no sample of another path loads
          if (!active) $active.next(false);
          $samplePath.next(snap.p ?? NOISE_DEFAULTS.p);
          $active.next(active);
          $noise.next({
            loop: snap.lp ?? KNOB_DEFAULTS.loop,
            keytrack: snap.kt ?? KNOB_DEFAULTS.keytrack,
            start: snap.st ?? KNOB_DEFAULTS.start,
            rand: snap.rd ?? KNOB_DEFAULTS.rand,
            pitch: snap.s ?? KNOB_DEFAULTS.pitch,
            fine: snap.f ?? KNOB_DEFAULTS.fine,
            pan: snap.pn ?? KNOB_DEFAULTS.pan,
            level: snap.g ?? KNOB_DEFAULTS.level,
          });
        },
      })
    )
    .destroy(({ id }) => {
      wavetables.removeTable(id);
    });

export const { ModelProvider: NoiseProvider, useModel: useNoise } = rxModelReact('noise', noise);

export type NoiseModule = ReturnType<typeof useNoise>;
export type NoiseModel = NoiseModule[0];
