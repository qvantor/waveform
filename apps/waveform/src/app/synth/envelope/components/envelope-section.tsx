import React from 'react';
import { AdsrEnvelope, Section } from '@waveform/ui-kit';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { ENVELOPE_TIME_MAX } from '@waveform/preset-schema';
import { useEnvelopes, useModulation } from '../../common/modules';
import { EnvelopeTabs } from './envelope-tabs';

export const EnvelopeSection = () => {
  const [{ $envelopes, $selected }, { setEnvelopeValue, select }] = useEnvelopes();
  const [, { addRoute }] = useModulation();
  const envelopes = useBehaviorSubject($envelopes);
  const selected = useBehaviorSubject($selected);
  return (
    <Section name={<EnvelopeTabs selected={selected} onSelect={select} onDrop={addRoute} />}>
      <AdsrEnvelope
        {...envelopes[selected]}
        maxTime={ENVELOPE_TIME_MAX}
        onChange={(key, value) => setEnvelopeValue(selected, key, value)}
      />
    </Section>
  );
};
