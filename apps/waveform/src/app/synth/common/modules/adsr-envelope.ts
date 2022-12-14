import { ObjectBS, rxModel, rxModelReact } from '@waveform/rxjs-react';
import { appSnapshotPlugin } from '../../../app';

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
    .plugins(appSnapshotPlugin(['$envelope']));

export const { ModelProvider: AdsrEnvelopeProvider, useModel: useAdsrEnvelope } = rxModelReact(
  'adsrEnvelope',
  adsrEnvelope
);

export type AdsrEnvelopeModule = ReturnType<typeof useAdsrEnvelope>;
export type AdsrEnvelopeModel = AdsrEnvelopeModule[0];
