import {
  asyncScheduler,
  BehaviorSubject,
  combineLatest,
  filter,
  map,
  skip,
  Subject,
  throttleTime,
} from 'rxjs';
import { PrimitiveBS, rxModel, rxModelReact } from '@waveform/rxjs-react';
import { divisionSeconds, TEMPO_DEFAULT, TEMPO_MAX, TEMPO_MIN, tempoOf } from '@waveform/preset-schema';
import { contextTimeAt, readStored, writeStored } from '../../../common/services';
import { LFO_LEAD, LFO_STATE_INTERVAL } from '../lfo/lfo-curve';
import {
  beatAt,
  firstSegment,
  nextSegment,
  segmentAt,
  TempoSegment,
  timeAt,
  withSegment,
} from '../transport/tempo-map';
import { SynthCoreModule } from './synth-core';

interface Deps {
  synthCore: SynthCoreModule;
}

// internal: the tempo of the field; midi: a MIDI Clock leads the tempo and the position
export type TempoSource = 'internal' | 'midi';

// a new segment of the tempo map: a new tempo from its time on (the beat goes on), or the transport moved to a
// beat (locate: a MIDI Start or Song Position; a track of notes would Play from one)
export interface TempoChange {
  segment: TempoSegment;
  locate: boolean;
}

// the tempo of the field is kept by the browser (localStorage), not by a preset: a preset switch keeps it; where
// the storage keeps nothing it is 120 until the page reloads
const TEMPO_KEY = 'tempo';
const isTempo = (value: unknown): value is number =>
  typeof value === 'number' && value >= TEMPO_MIN && value <= TEMPO_MAX;
const readTempo = () => tempoOf(readStored('localStorage', TEMPO_KEY, TEMPO_DEFAULT, isTempo));

const newest = (segments: TempoSegment[]) => segments[segments.length - 1];

interface Segments {
  $tempo: PrimitiveBS<number>;
  $segments: BehaviorSubject<TempoSegment[]>;
  $changes: Subject<TempoChange>;
}
const applySegment = ({ $tempo, $segments, $changes }: Segments, segment: TempoSegment, locate: boolean) => {
  $segments.next(withSegment($segments.value, segment));
  if ($tempo.value !== segment.bpm) $tempo.next(segment.bpm);
  $changes.next({ segment, locate });
};

// the tempo and the transport: the beats on the clock of the context (tempo-map.ts), beat 0 at its time 0. A new
// tempo is a segment from now + LFO_LEAD on at the beat the transport is at there (the grid goes on), at most every
// LFO_STATE_INTERVAL (a drag of the field: each segment is a state of the LFOs in BPM to five threads). The LFOs,
// the envelopes, the delay and the voices read it; the MIDI controller leads it by a MIDI Clock
export const transport = ({ synthCore: [{ audioCtx }] }: Deps) =>
  rxModel(() => {
    // the tempo of the field (kept)
    const $bpm = new PrimitiveBS<number>(readTempo());
    const $source = new PrimitiveBS<TempoSource>('internal');
    // the tempo in effect: of the newest segment (the field's, or of the MIDI Clock, not kept)
    const $tempo = new PrimitiveBS<number>($bpm.value);
    // a MIDI Start up to its Stop (a track of notes would Play)
    const $playing = new PrimitiveBS<boolean>(false);
    const $segments = new BehaviorSubject<TempoSegment[]>([firstSegment($bpm.value)]);
    const $changes = new Subject<TempoChange>();
    return {
      $bpm,
      $source,
      $tempo,
      $playing,
      $segments,
      $changes,
      // the beat the transport is at at `t` (seconds of the context)
      beatAt: (t: number) => beatAt($segments.value, t),
      // the tempo at `t`
      tempoAt: (t: number) => segmentAt($segments.value, t).bpm,
      // the time it comes to `beat` at, at the tempo of now
      timeAt: (beat: number) => timeAt($segments.value, beat),
      // seconds of a division (TEMPO_DIVISIONS) at the tempo in effect
      secondsOf: (division: number) => divisionSeconds(division, $tempo.value),
      // the time of the context the output plays at `ms` of performance.now() (an event, a MIDI Clock)
      contextTimeAt: (ms: number) => contextTimeAt(audioCtx, ms),
    };
  })
    .actions((model) => {
      const { $bpm, $source, $tempo, $playing } = model;
      const apply = (segment: TempoSegment, locate: boolean) => applySegment(model, segment, locate);
      // the time a segment can start at: its states reach the audio threads before it
      const soonest = () => audioCtx.currentTime + LFO_LEAD;
      return {
        // the tempo of the field (on its grid of 0.01, within 20..300)
        setBpm: (bpm: number) => {
          const next = tempoOf(bpm);
          if (next !== $bpm.value) $bpm.next(next);
        },
        // the transport at `beat` at `at` (at `bpm`, by default the tempo in effect); at now + LFO_LEAD at the
        // soonest, on the line of the beats from there
        locate: (beat: number, at: number, bpm = $tempo.value) => {
          const time = Math.max(at, soonest());
          apply({ time, beat: beat + ((time - at) * bpm) / 60, bpm }, true);
        },
        // a segment of a MIDI Clock: its tempo from `time` on, at `beat` there (no step of the beat when it is on
        // the line before); at now + LFO_LEAD at the soonest, on its line
        follow: ({ time, beat, bpm }: TempoSegment) => {
          const at = Math.max(time, soonest());
          apply({ time: at, beat: beat + ((at - time) * bpm) / 60, bpm }, false);
        },
        setSource: (source: TempoSource) => {
          if (source !== $source.value) $source.next(source);
        },
        setPlaying: (playing: boolean) => {
          if (playing !== $playing.value) $playing.next(playing);
        },
      };
    })
    .subscriptions((model) => [
      model.$bpm.pipe(skip(1)).subscribe((bpm) => writeStored('localStorage', TEMPO_KEY, bpm)),
      // the tempo of the field, while no MIDI Clock leads it
      combineLatest([model.$bpm, model.$source])
        .pipe(
          filter(([, source]) => source === 'internal'),
          map(([bpm]) => bpm),
          // (the first emission is the tempo of the newest segment: it would hold back the first change)
          filter((bpm) => newest(model.$segments.value).bpm !== bpm),
          throttleTime(LFO_STATE_INTERVAL * 1000, asyncScheduler, { leading: true, trailing: true })
        )
        .subscribe((bpm) => {
          const segments = model.$segments.value;
          if (newest(segments).bpm === bpm) return;
          applySegment(model, nextSegment(segments, audioCtx.currentTime + LFO_LEAD, bpm), false);
        }),
    ]);

export const {
  ModelProvider: TransportProvider,
  useModel: useTransport,
  Context: TransportContext,
} = rxModelReact('transport', transport);

export type TransportModule = ReturnType<typeof useTransport>;
