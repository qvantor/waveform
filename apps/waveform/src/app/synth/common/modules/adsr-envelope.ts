import { ObjectBS, rxModel, rxModelReact } from '@waveform/rxjs-react';

const adsrEnvelope = () =>
  rxModel(() => {
    const $envelope = new ObjectBS({
      attack: 0.005,
      hold: 0.1,
      decay: 0.05,
      sustain: 0.4,
      release: 0.005,
    });
    return { $envelope };
  }).actions(({ $envelope }) => ({
    setEnvelopeValue: (key: keyof typeof $envelope.value, value: number) =>
      $envelope.next({
        ...$envelope.value,
        [key]: value,
      }),
  }));

export const { ModelProvider: AdsrEnvelopeProvider, useModel: useAdsrEnvelope } = rxModelReact(
  'adsrEnvelope',
  adsrEnvelope
);

export type AdsrEnvelopeModule = ReturnType<typeof useAdsrEnvelope>;
export type AdsrEnvelopeModel = AdsrEnvelopeModule[0];
