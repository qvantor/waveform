import React from 'react';
import { AdsrEnvelope, Section } from '@waveform/ui-kit';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { ENVELOPE_CURVE_MAX, ENVELOPE_CURVES, ENVELOPE_TIME_MAX, EnvelopeId } from '@waveform/preset-schema';
import { useEnvelopes, useModulation } from '../../common/modules';
import { EnvelopeTabs } from './envelope-tabs';
import { EnvelopeDot } from './envelope-dot';
import { VelocitySection } from './velocity-section';

// the envelope of a tab: its stages and their curves, the shape the voices play
const EnvelopeChart = ({ id }: { id: EnvelopeId }) => {
  const [{ $envelopes }, { setEnvelopeValue, setEnvelopeCurve }] = useEnvelopes();
  const envelopes = useBehaviorSubject($envelopes);
  return (
    <AdsrEnvelope
      {...envelopes[id]}
      maxTime={ENVELOPE_TIME_MAX}
      onChange={(key, value) => setEnvelopeValue(id, key, value)}
      // the points on the curves: a double click gives a stage its default curve again
      curveMax={ENVELOPE_CURVE_MAX}
      defaultCurves={ENVELOPE_CURVES}
      onCurveChange={(stage, k) => setEnvelopeCurve(id, stage, k)}
    >
      <EnvelopeDot key={id} id={id} env={envelopes[id]} />
    </AdsrEnvelope>
  );
};

export const EnvelopeSection = () => {
  const [{ $selected }, { select }] = useEnvelopes();
  const [, { addRoute }] = useModulation();
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
      {selected === 'velo' ? <VelocitySection /> : <EnvelopeChart id={selected} />}
    </Section>
  );
};
