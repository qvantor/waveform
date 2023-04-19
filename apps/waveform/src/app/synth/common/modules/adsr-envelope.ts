import { ObjectBS, rxModel, rxModelReact } from '@waveform/rxjs-react';
import { urlSnapshotPlugin } from '../../../app';

const adsrEnvelope = () =>
  rxModel(() => {
    const $envelope = new ObjectBS({
      attack: 0.005,
      hold: 0.1,
      decay: 0,
      sustain: 1,
      release: 0.005,
    });
    return { $envelope };
  })
    .actions(({ $envelope }) => ({
      setEnvelopeValue: (key: keyof typeof $envelope.value, value: number) =>
        $envelope.next({
          ...$envelope.value,
          [key]: value,
        }),
    }))
    .plugins(
      urlSnapshotPlugin({
        modelToSnap: ({ $envelope }) => $envelope.value,
        applySnap: (snap, { $envelope }) =>
          $envelope.next({
            attack: snap.attack ?? 0.005,
            hold: snap.hold ?? 0.1,
            decay: snap.decay ?? 0,
            sustain: snap.sustain ?? 1,
            release: snap.release ?? 0.005,
          }),
      })
    );

export const { ModelProvider: AdsrEnvelopeProvider, useModel: useAdsrEnvelope } = rxModelReact(
  'adsr',
  adsrEnvelope
);

export type AdsrEnvelopeModule = ReturnType<typeof useAdsrEnvelope>;
export type AdsrEnvelopeModel = AdsrEnvelopeModule[0];
