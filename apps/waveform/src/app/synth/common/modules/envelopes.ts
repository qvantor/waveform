import { BehaviorSubject } from 'rxjs';
import { mapValues } from 'lodash';
import { ObjectBS, rxModel, rxModelReact } from '@waveform/rxjs-react';
import {
  DIVISION_MAX,
  divisionSeconds,
  divisionWithin,
  ENVELOPE_CURVES,
  ENVELOPE_DEFAULTS,
  ENVELOPE_DIVISIONS,
  ENVELOPE_KEYS,
  ENVELOPE_TIME_DIVISIONS,
  ENVELOPE_TIME_MAX,
  ENVELOPE_TIME_STAGES,
  ENVELOPES,
  envelopeCurve,
  EnvelopeCurveStage,
  EnvelopeId,
  EnvelopeStage,
  EnvelopeTimeStage,
  ModSource,
  nearestDivision,
  quartersOf,
  VELOCITY_DEFAULTS,
  VelocityKnob,
} from '@waveform/preset-schema';
import { urlSnapshotPlugin } from '../../../app';
import type { EnvelopeParams } from '../envelope/envelope-curve';
import type { TransportModule } from './transport';

interface Deps {
  transport: TransportModule;
}

// the knobs of an envelope: its stages with the curves of them; in BPM (`bpm`) the times are divisions (`divs`:
// indexes into TEMPO_DIVISIONS) at the tempo, the seconds those of MS
export type EnvelopeKnobs = Required<EnvelopeParams> & {
  bpm: boolean;
  divs: Record<EnvelopeTimeStage, number>;
};
export type Envelopes = Record<EnvelopeId, EnvelopeKnobs>;

// the envelope of the knobs a note plays (it reads them at its note on): in BPM the seconds of their divisions at
// `bpm` (a stage may be longer than 32 s: 32 bars at 20 BPM are 384 s)
export const envelopeSeconds = (
  { bpm: synced, divs, ...envelope }: EnvelopeKnobs,
  bpm: number
): Required<EnvelopeParams> =>
  synced ? { ...envelope, ...mapValues(divs, (division) => divisionSeconds(division, bpm)) } : envelope;

// the knobs of the velocity: Amp (the share of the volume of a note it takes) and k (the curve of VELO)
export type VelocityKnobs = Record<VelocityKnob, number>;

const isEnvelope = (id: ModSource): id is EnvelopeId => (ENVELOPES as readonly string[]).includes(id);

// the snapshot of the model, env: { e1, e2, e3, vel }
type EnvSnap = Record<string, EnvelopeKnobs | VelocityKnobs>;

const isDivision = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) <= DIVISION_MAX;

// the envelopes of a snapshot: a missing envelope, stage, curve or division is its default, 0 and false are kept; a
// curve on the grid of the points within its range (a url snapshot skips presetDataSchema: a k near 0 would be
// NaN), one that isn't a number its default; a division one of the steps of a time (a dotted one: its straight
// one)
const envelopesFrom = (snap: Partial<EnvSnap>) =>
  Object.fromEntries(
    ENVELOPES.map((id) => {
      const values = (snap[ENVELOPE_KEYS[id]] ?? {}) as Partial<EnvelopeParams> & {
        bpm?: unknown;
        divs?: Partial<Record<EnvelopeTimeStage, unknown>>;
      };
      return [
        id,
        {
          ...mapValues(ENVELOPE_DEFAULTS[id], (value, stage) => values[stage as EnvelopeStage] ?? value),
          curves: mapValues(ENVELOPE_CURVES, (k, stage) => {
            const value = values.curves?.[stage as EnvelopeCurveStage];
            return typeof value === 'number' ? envelopeCurve(value) : k;
          }),
          bpm: typeof values.bpm === 'boolean' ? values.bpm : false,
          divs: mapValues(ENVELOPE_DIVISIONS[id], (division, stage) => {
            const value = values.divs?.[stage as EnvelopeTimeStage];
            return isDivision(value) ? divisionWithin(value, ENVELOPE_TIME_DIVISIONS) : division;
          }),
        },
      ];
    })
  ) as Envelopes;

// the velocity of a snapshot: a missing knob is its default, 0 is kept; Amp within 0..1, the curve on the grid of
// the point of the chart (a url snapshot skips presetDataSchema: `vel` may be anything, null too), one that isn't
// a number its default
const velocityFrom = (snap?: Partial<Record<VelocityKnob, unknown>> | null): VelocityKnobs => {
  const { amp, k } = snap ?? {};
  return {
    amp: typeof amp === 'number' ? Math.min(1, Math.max(0, amp)) : VELOCITY_DEFAULTS.amp,
    k: typeof k === 'number' ? envelopeCurve(k) : VELOCITY_DEFAULTS.k,
  };
};

// the envelopes ENV 1–3: ENV 1 is the volume of every note, each of them modulates the knobs it is assigned
// to. A note reads them when it is pressed (an edit changes the next notes; in BPM a new tempo too). The curves
// of their stages are dragged on the chart, ENVELOPE_CURVES by default. With them the velocity of a note (VELO, a
// source of the routes, and its share of the volume), read when it is pressed too
export const envelopes = ({ transport: [{ $tempo }] }: Deps) =>
  rxModel(() => {
    const $envelopes = new ObjectBS<Envelopes>(envelopesFrom({}));
    const $velocity = new ObjectBS<VelocityKnobs>(velocityFrom());
    // the selected tab (an envelope, the velocity or an LFO), the knobs show its routes, and the envelope the ENV
    // section shows: the last one selected. The state of the UI, not in the preset
    const $selected = new BehaviorSubject<ModSource>(ENVELOPES[0]);
    const $envelope = new BehaviorSubject<EnvelopeId>(ENVELOPES[0]);
    return { $envelopes, $velocity, $selected, $envelope };
  })
    .actions(({ $envelopes, $velocity, $selected, $envelope }) => ({
      setEnvelopeValue: (id: EnvelopeId, key: EnvelopeStage, value: number) =>
        $envelopes.next({ ...$envelopes.value, [id]: { ...$envelopes.value[id], [key]: value } }),
      // BPM: each time takes the division nearest to its seconds at the tempo; MS: the seconds of its division
      // (32 s at most)
      setEnvelopeBpm: (id: EnvelopeId, bpm: boolean) => {
        const envelope = $envelopes.value[id];
        if (envelope.bpm === bpm) return;
        const tempo = $tempo.value;
        const next = bpm
          ? {
              ...envelope,
              bpm,
              divs: mapValues(envelope.divs, (_, stage) =>
                nearestDivision(
                  quartersOf(envelope[stage as EnvelopeTimeStage], tempo),
                  ENVELOPE_TIME_DIVISIONS
                )
              ),
            }
          : {
              ...envelope,
              bpm,
              ...Object.fromEntries(
                ENVELOPE_TIME_STAGES.map((stage) => [
                  stage,
                  Math.min(ENVELOPE_TIME_MAX, divisionSeconds(envelope.divs[stage], tempo)),
                ])
              ),
            };
        $envelopes.next({ ...$envelopes.value, [id]: next });
      },
      // a division of a time in BPM (one of its steps, else the nearest)
      setEnvelopeDivision: (id: EnvelopeId, stage: EnvelopeTimeStage, division: number) => {
        const envelope = $envelopes.value[id];
        $envelopes.next({
          ...$envelopes.value,
          [id]: {
            ...envelope,
            divs: { ...envelope.divs, [stage]: divisionWithin(division, ENVELOPE_TIME_DIVISIONS) },
          },
        });
      },
      setEnvelopeCurve: (id: EnvelopeId, stage: EnvelopeCurveStage, k: number) => {
        const envelope = $envelopes.value[id];
        $envelopes.next({
          ...$envelopes.value,
          [id]: { ...envelope, curves: { ...envelope.curves, [stage]: k } },
        });
      },
      setVelocity: (knob: VelocityKnob, value: number) =>
        $velocity.next({ ...$velocity.value, [knob]: value }),
      select: (id: ModSource) => {
        $selected.next(id);
        if (isEnvelope(id)) $envelope.next(id);
      },
    }))
    .plugins(
      urlSnapshotPlugin({
        // env: { e1, e2, e3, vel }, each envelope { attack, hold, decay, sustain, release, curves: { attack,
        // decay, release }, bpm, divs: { attack, hold, decay, release } }, vel { amp, k }
        modelToSnap: ({ $envelopes, $velocity }): EnvSnap => ({
          ...Object.fromEntries(ENVELOPES.map((id) => [ENVELOPE_KEYS[id], $envelopes.value[id]])),
          vel: $velocity.value,
        }),
        applySnap: (snap, { $envelopes, $velocity }) => {
          $envelopes.next(envelopesFrom(snap));
          $velocity.next(velocityFrom(snap['vel'] as Partial<VelocityKnobs> | null | undefined));
        },
      })
    );

export const {
  ModelProvider: EnvelopesProvider,
  useModel: useEnvelopes,
  Context: EnvelopesContext,
} = rxModelReact('env', envelopes);

export type EnvelopesModule = ReturnType<typeof useEnvelopes>;
