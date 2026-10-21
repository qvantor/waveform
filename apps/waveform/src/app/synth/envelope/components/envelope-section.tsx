import React from 'react';
import { AdsrEnvelope, Section } from '@waveform/ui-kit';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { ENVELOPE_CURVE_MAX, ENVELOPE_CURVES, ENVELOPE_TIME_MAX } from '@waveform/preset-schema';
import { useEnvelopes, useModulation } from '../../common/modules';
import { EnvelopeTabs } from './envelope-tabs';
import { EnvelopeDot } from './envelope-dot';

export const EnvelopeSection = () => {
  const [{ $envelopes, $selected }, { setEnvelopeValue, setEnvelopeCurve, select }] = useEnvelopes();
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
        // the stages and their curves, the shape the voices play
        {...envelopes[selected]}
        maxTime={ENVELOPE_TIME_MAX}
        onChange={(key, value) => setEnvelopeValue(selected, key, value)}
        // the points on the curves: a double click gives a stage its default curve again
        curveMax={ENVELOPE_CURVE_MAX}
        defaultCurves={ENVELOPE_CURVES}
        onCurveChange={(stage, k) => setEnvelopeCurve(selected, stage, k)}
      >
        <EnvelopeDot key={selected} id={selected} env={envelopes[selected]} />
      </AdsrEnvelope>
    </Section>
  );
};
