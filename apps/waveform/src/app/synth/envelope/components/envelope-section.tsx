import React from 'react';
import { AdsrEnvelope, Section } from '@waveform/ui-kit';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import {
  ENVELOPE_CURVE_MAX,
  ENVELOPE_CURVES,
  ENVELOPE_TIME_MAX,
  ENVELOPES,
  EnvelopeId,
} from '@waveform/preset-schema';
import { useEnvelopes } from '../../common/modules';
import { SourceTabs } from '../../modulation/source-tabs';
import { EnvelopeDot } from './envelope-dot';

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

// ENV 1–3: the chart of the last one selected (VELO selected in its section, it stays)
export const EnvelopeSection = () => {
  const [{ $envelope }] = useEnvelopes();
  const envelope = useBehaviorSubject($envelope);
  return (
    <Section plain name={<SourceTabs label='Envelopes' sources={ENVELOPES} shown={envelope} />}>
      <EnvelopeChart id={envelope} />
    </Section>
  );
};
