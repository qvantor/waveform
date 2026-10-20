import React from 'react';
import { AdsrEnvelope, Section } from '@waveform/ui-kit';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { ENVELOPE_TIME_MAX } from '@waveform/preset-schema';
import { useEnvelopes, useModulation } from '../../common/modules';
import { ENVELOPE_CURVES, withCurves } from '../../common/envelope/envelope-curve';
import { EnvelopeTabs } from './envelope-tabs';
import { EnvelopeDot } from './envelope-dot';

export const EnvelopeSection = () => {
  const [{ $envelopes, $selected }, { setEnvelopeValue, select }] = useEnvelopes();
  const [, { addRoute }] = useModulation();
  const envelopes = useBehaviorSubject($envelopes);
  const selected = useBehaviorSubject($selected);
  return (
    <Section
      plain
      name={
        <EnvelopeTabs
          selected={selected}
          onSelect={select}
          // the knobs show the route of the selected tab: the new one shows at once
          onDrop={(id, target) => {
            addRoute(id, target);
            select(id);
          }}
        />
      }
    >
      <AdsrEnvelope
        {...envelopes[selected]}
        // the shape the voices play
        curves={ENVELOPE_CURVES}
        maxTime={ENVELOPE_TIME_MAX}
        onChange={(key, value) => setEnvelopeValue(selected, key, value)}
      >
        <EnvelopeDot key={selected} id={selected} env={withCurves(envelopes[selected])} />
      </AdsrEnvelope>
    </Section>
  );
};
