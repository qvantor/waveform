import { BehaviorSubject } from 'rxjs';
import { ObjectBS, rxModel, rxModelReact } from '@waveform/rxjs-react';
import {
  ENVELOPE_DEFAULTS,
  ENVELOPE_KEYS,
  ENVELOPES,
  EnvelopeId,
  EnvelopeStage,
} from '@waveform/preset-schema';
import { urlSnapshotPlugin } from '../../../app';
import type { EnvelopeParams } from '../envelope/envelope-curve';

export type Envelopes = Record<EnvelopeId, EnvelopeParams>;

const defaultEnvelopes = () =>
  Object.fromEntries(ENVELOPES.map((id) => [id, { ...ENVELOPE_DEFAULTS[id] }])) as Envelopes;

// the envelopes ENV 1–3: ENV 1 is the volume of every note, each of them modulates the knobs it is assigned
// to. A note reads them when it is pressed (an edit changes the next notes)
export const envelopes = () =>
  rxModel(() => {
    const $envelopes = new ObjectBS<Envelopes>(defaultEnvelopes());
    // the envelope the section shows and its knobs edit: the state of the UI, not in the preset
    const $selected = new BehaviorSubject<EnvelopeId>(ENVELOPES[0]);
    return { $envelopes, $selected };
  })
    .actions(({ $envelopes, $selected }) => ({
      setEnvelopeValue: (id: EnvelopeId, key: EnvelopeStage, value: number) =>
        $envelopes.next({ ...$envelopes.value, [id]: { ...$envelopes.value[id], [key]: value } }),
      select: (id: EnvelopeId) => $selected.next(id),
    }))
    .plugins(
      urlSnapshotPlugin({
        // env: { e1, e2, e3 }
        modelToSnap: ({ $envelopes }) =>
          Object.fromEntries(
            ENVELOPES.map((id) => [ENVELOPE_KEYS[id], { ...$envelopes.value[id] }])
          ) as Record<string, Record<EnvelopeStage, number>>,
        // a missing envelope or stage is its default, 0 is kept
        applySnap: (snap, { $envelopes }) =>
          $envelopes.next(
            Object.fromEntries(
              ENVELOPES.map((id) => {
                const values: Partial<EnvelopeParams> = snap[ENVELOPE_KEYS[id]] ?? {};
                const defaults = ENVELOPE_DEFAULTS[id];
                return [
                  id,
                  {
                    attack: values.attack ?? defaults.attack,
                    hold: values.hold ?? defaults.hold,
                    decay: values.decay ?? defaults.decay,
                    sustain: values.sustain ?? defaults.sustain,
                    release: values.release ?? defaults.release,
                  },
                ];
              })
            ) as Envelopes
          ),
      })
    );

export const {
  ModelProvider: EnvelopesProvider,
  useModel: useEnvelopes,
  Context: EnvelopesContext,
} = rxModelReact('env', envelopes);

export type EnvelopesModule = ReturnType<typeof useEnvelopes>;
