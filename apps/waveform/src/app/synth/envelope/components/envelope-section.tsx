import React from 'react';
import styled from 'styled-components';
import { AdsrEnvelope, Section, SwitchKey, SwitchKeys } from '@waveform/ui-kit';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import {
  ENVELOPE_CURVE_MAX,
  ENVELOPE_CURVES,
  ENVELOPE_DEFAULTS,
  ENVELOPE_DIVISIONS,
  ENVELOPE_TIME_MAX,
  ENVELOPES,
  EnvelopeId,
  ENVELOPE_TIME_DIVISIONS,
  TEMPO_DIVISIONS,
} from '@waveform/preset-schema';
import { useEnvelopes, useTransport } from '../../common/modules';
import { envelopeSeconds } from '../../common/modules/envelopes';
import { SourceTabs } from '../../modulation/source-tabs';
import { EnvelopeDot } from './envelope-dot';

// BPM alone on a plate as large as the knob of Release, right of it (the plate of the delay beside Time)
const Plate = styled(SwitchKeys)`
  width: 100%;
`;

// memoized: the chart renders on every move of a knob, a key is a tooltip
const TempoKey = React.memo(
  ({ id, bpm, setBpm }: { id: EnvelopeId; bpm: boolean; setBpm: (id: EnvelopeId, on: boolean) => void }) => (
    <Plate aria-label='Tempo' stack>
      <SwitchKey
        label='BPM'
        name='Tempo sync'
        hint='The times in note values'
        on={bpm}
        onChange={(on) => setBpm(id, on)}
      />
    </Plate>
  )
);

const formatDivision = (division: number) => TEMPO_DIVISIONS[division]?.id ?? '';

// the envelope of a tab: its stages and their curves, the shape the voices play; in BPM its times step through the
// divisions of the tempo (Off, 1/512 … 32 bar), the chart and the dot draw their seconds at the tempo now
const EnvelopeChart = ({ id }: { id: EnvelopeId }) => {
  const [{ $envelopes }, { setEnvelopeValue, setEnvelopeCurve, setEnvelopeBpm, setEnvelopeDivision }] =
    useEnvelopes();
  const [{ $tempo }] = useTransport();
  const knobs = useBehaviorSubject($envelopes)[id];
  const tempo = useBehaviorSubject($tempo);
  const envelope = React.useMemo(() => envelopeSeconds(knobs, tempo), [knobs, tempo]);
  return (
    <AdsrEnvelope
      {...envelope}
      maxTime={ENVELOPE_TIME_MAX}
      onChange={(key, value) => setEnvelopeValue(id, key, value)}
      defaultValues={ENVELOPE_DEFAULTS[id]}
      timeSteps={
        knobs.bpm
          ? {
              steps: ENVELOPE_TIME_DIVISIONS,
              values: knobs.divs,
              format: formatDivision,
              defaults: ENVELOPE_DIVISIONS[id],
              onChange: (stage, division) => setEnvelopeDivision(id, stage, division),
            }
          : undefined
      }
      aside={<TempoKey id={id} bpm={knobs.bpm} setBpm={setEnvelopeBpm} />}
      // the points on the curves: a double click gives a stage its default curve again
      curveMax={ENVELOPE_CURVE_MAX}
      defaultCurves={ENVELOPE_CURVES}
      onCurveChange={(stage, k) => setEnvelopeCurve(id, stage, k)}
    >
      <EnvelopeDot key={id} id={id} env={envelope} />
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
