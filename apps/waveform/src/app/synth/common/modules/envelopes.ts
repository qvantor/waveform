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
} from '@waveform/preset-schema';
import { urlSnapshotPlugin } from '../../../app';
import type { EnvelopeParams } from '../envelope/envelope-curve';

// the envelopes of the knobs with the curves of their stages
export type Envelopes = Record<EnvelopeId, Required<EnvelopeParams>>;

// the envelopes of a snapshot: a missing envelope, stage or curve is its default, 0 is kept; a curve on the
// grid of the points within its range (a url snapshot skips presetDataSchema: a k near 0 would be NaN), one that
// isn't a number its default
const envelopesFrom = (snap: Partial<Record<string, Partial<EnvelopeParams>>>) =>
  Object.fromEntries(
    ENVELOPES.map((id) => {
      const values = snap[ENVELOPE_KEYS[id]] ?? {};
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

// the envelopes ENV 1–3: ENV 1 is the volume of every note, each of them modulates the knobs it is assigned
// to. A note reads them when it is pressed (an edit changes the next notes). The curves of their stages are
// dragged on the chart, ENVELOPE_CURVES by default
export const envelopes = () =>
  rxModel(() => {
    const $envelopes = new ObjectBS<Envelopes>(envelopesFrom({}));
    // the envelope the section shows and its knobs edit: the state of the UI, not in the preset
    const $selected = new BehaviorSubject<EnvelopeId>(ENVELOPES[0]);
    return { $envelopes, $selected };
  })
    .actions(({ $envelopes, $selected }) => ({
      setEnvelopeValue: (id: EnvelopeId, key: EnvelopeStage, value: number) =>
        $envelopes.next({ ...$envelopes.value, [id]: { ...$envelopes.value[id], [key]: value } }),
      setEnvelopeCurve: (id: EnvelopeId, stage: EnvelopeCurveStage, k: number) => {
        const envelope = $envelopes.value[id];
        $envelopes.next({
          ...$envelopes.value,
          [id]: { ...envelope, curves: { ...envelope.curves, [stage]: k } },
        });
      },
      select: (id: EnvelopeId) => $selected.next(id),
    }))
    .plugins(
      urlSnapshotPlugin({
        // env: { e1, e2, e3 }, each { attack, hold, decay, sustain, release, curves: { attack, decay, release } }
        modelToSnap: ({ $envelopes }) =>
          Object.fromEntries(ENVELOPES.map((id) => [ENVELOPE_KEYS[id], $envelopes.value[id]])),
        applySnap: (snap, { $envelopes }) => $envelopes.next(envelopesFrom(snap)),
      })
    );

export const {
  ModelProvider: EnvelopesProvider,
  useModel: useEnvelopes,
  Context: EnvelopesContext,
} = rxModelReact('env', envelopes);

export type EnvelopesModule = ReturnType<typeof useEnvelopes>;
