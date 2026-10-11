import React from 'react';
import { AdsrEnvelope, Section } from '@waveform/ui-kit';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { useAdsrEnvelope } from '../../common/modules';

export const EnvelopeSection = () => {
  const [{ $envelope }, { setEnvelopeValue }] = useAdsrEnvelope();
  const envelope = useBehaviorSubject($envelope);
  return (
    <Section name='Envelope'>
      <AdsrEnvelope {...envelope} onChange={setEnvelopeValue} />
    </Section>
  );
};
