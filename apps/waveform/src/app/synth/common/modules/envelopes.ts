import { BehaviorSubject } from 'rxjs';
import { mapValues } from 'lodash';
import { ObjectBS, rxModel, rxModelReact } from '@waveform/rxjs-react';
import {
  ENVELOPE_CURVES,
  ENVELOPE_DEFAULTS,
  ENVELOPE_KEYS,
  ENVELOPES,
  envelopeCurve,
  EnvelopeCurveStage,
  EnvelopeId,
  EnvelopeStage,
  ModSource,
  VELOCITY_DEFAULTS,
  VelocityKnob,
} from '@waveform/preset-schema';
import { urlSnapshotPlugin } from '../../../app';
import type { EnvelopeParams } from '../envelope/envelope-curve';

// the envelopes of the knobs with the curves of their stages
export type Envelopes = Record<EnvelopeId, Required<EnvelopeParams>>;

// the knobs of the velocity: Amp (the share of the volume of a note it takes) and k (the curve of VELO)
export type VelocityKnobs = Record<VelocityKnob, number>;

// the snapshot of the model, env: { e1, e2, e3, vel }
type EnvSnap = Record<string, Required<EnvelopeParams> | VelocityKnobs>;

// the envelopes of a snapshot: a missing envelope, stage or curve is its default, 0 is kept; a curve on the
// grid of the points within its range (a url snapshot skips presetDataSchema: a k near 0 would be NaN), one that
// isn't a number its default
const envelopesFrom = (snap: Partial<EnvSnap>) =>
  Object.fromEntries(
    ENVELOPES.map((id) => {
      const values = (snap[ENVELOPE_KEYS[id]] ?? {}) as Partial<EnvelopeParams>;
      return [
        id,
        {
          ...mapValues(ENVELOPE_DEFAULTS[id], (value, stage) => values[stage as EnvelopeStage] ?? value),
          curves: mapValues(ENVELOPE_CURVES, (k, stage) => {
            const value = values.curves?.[stage as EnvelopeCurveStage];
            return typeof value === 'number' ? envelopeCurve(value) : k;
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
// to. A note reads them when it is pressed (an edit changes the next notes). The curves of their stages are
// dragged on the chart, ENVELOPE_CURVES by default. With them the velocity of a note (VELO, a source of the
// routes, and its share of the volume), read when it is pressed too
export const envelopes = () =>
  rxModel(() => {
    const $envelopes = new ObjectBS<Envelopes>(envelopesFrom({}));
    const $velocity = new ObjectBS<VelocityKnobs>(velocityFrom());
    // the tab the section shows and its knobs edit (an envelope or the velocity): the state of the UI, not in
    // the preset
    const $selected = new BehaviorSubject<ModSource>(ENVELOPES[0]);
    return { $envelopes, $velocity, $selected };
  })
    .actions(({ $envelopes, $velocity, $selected }) => ({
      setEnvelopeValue: (id: EnvelopeId, key: EnvelopeStage, value: number) =>
        $envelopes.next({ ...$envelopes.value, [id]: { ...$envelopes.value[id], [key]: value } }),
      setEnvelopeCurve: (id: EnvelopeId, stage: EnvelopeCurveStage, k: number) => {
        const envelope = $envelopes.value[id];
        $envelopes.next({
          ...$envelopes.value,
          [id]: { ...envelope, curves: { ...envelope.curves, [stage]: k } },
        });
      },
      setVelocity: (knob: VelocityKnob, value: number) =>
        $velocity.next({ ...$velocity.value, [knob]: value }),
      select: (id: ModSource) => $selected.next(id),
    }))
    .plugins(
      urlSnapshotPlugin({
        // env: { e1, e2, e3, vel }, each envelope { attack, hold, decay, sustain, release, curves: { attack,
        // decay, release } }, vel { amp, k }
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
