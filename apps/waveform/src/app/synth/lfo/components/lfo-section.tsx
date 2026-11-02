import React from 'react';
import styled from 'styled-components';
import { formatTime, Handle, Section, Select, SwitchKey } from '@waveform/ui-kit';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import {
  DIVISION_MAX,
  DIVISION_OFF,
  ENVELOPE_TIME_MAX,
  isLfoKnob,
  LFO_DEFAULTS,
  LFO_RATE_MAX,
  LFO_RATE_MIN,
  LFO_SMOOTH_MAX,
  LfoId,
  LfoKnob,
  LfoMode,
  LFOS,
  rateDivisions,
  TEMPO_DIVISIONS,
  TIME_DIVISIONS,
} from '@waveform/preset-schema';
import { useLfos } from '../../common/modules';
import { DIVISION_KEYS, LfoParams, LfoTimeKnob } from '../../common/modules/lfos';
import { useKnobModulation } from '../../modulation/use-knob-modulation';
import { SourceTabs } from '../../modulation/source-tabs';
import { CUSTOM_SHAPE, LFO_SHAPE_OPTIONS, shapeOptionOf } from '../lfo-shapes';
import { LfoChart } from './lfo-chart';

// the shapes by category; points of its own that are none of them show as Custom, not chosen
const SHAPES = LFO_SHAPE_OPTIONS.map(({ id, name, group }) => ({ name, value: id, group }));
const SHAPES_CUSTOM = [...SHAPES, { name: 'Custom', value: CUSTOM_SHAPE, disabled: true }];
const MODES: { name: string; value: LfoMode }[] = [
  { name: 'Retrig', value: 'retrig' },
  { name: 'Free', value: 'free' },
];

// the chart takes what the controls leave
const Root = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 5px;
`;

const Row = styled.div`
  flex: none;
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr) auto;
  gap: 5px;
`;

// BPM, HOST, TRIP and DOT as high as the selects
const Keys = styled.div`
  display: flex;
  gap: 2px;
`;

const Knobs = styled.div`
  flex: none;
  display: flex;
  justify-content: space-between;
`;

// the knobs of an LFO in the units of their params (seconds; Rate goes by the frequency, right faster, and shows
// the period), each a target of the envelopes and the velocity
const KNOBS: Record<
  LfoKnob,
  Pick<
    React.ComponentProps<typeof Handle>,
    'min' | 'max' | 'mode' | 'precision' | 'formatValue' | 'label' | 'name' | 'wrap'
  >
> = {
  rate: {
    min: 1 / LFO_RATE_MAX,
    max: 1 / LFO_RATE_MIN,
    mode: 'log',
    precision: 1000,
    label: 'Rate',
    name: 'LFO period',
    formatValue: (frequency) => formatTime(1 / frequency),
  },
  delay: {
    min: 0,
    max: ENVELOPE_TIME_MAX,
    mode: 'pow',
    precision: 10000,
    label: 'Delay',
    formatValue: formatTime,
  },
  rise: {
    min: 0,
    max: ENVELOPE_TIME_MAX,
    mode: 'pow',
    precision: 10000,
    label: 'Rise',
    formatValue: formatTime,
  },
  smooth: {
    min: 0,
    max: LFO_SMOOTH_MAX,
    mode: 'pow',
    precision: 10000,
    label: 'Smooth',
    formatValue: formatTime,
  },
  phase: {
    min: 0,
    max: 1,
    precision: 1000,
    label: 'Phase',
    formatValue: (phase) => `${Math.round(phase * 360)}°`,
    // around the cycle: a route moves it past 360° to 0°
    wrap: true,
  },
};

// in BPM Rate, Delay and Rise step through divisions (indexes into TEMPO_DIVISIONS): Rate right faster, by TRIP
// and DOT, the times right longer from Off; the default 1/4 and Off
const RATE_STEPS = [false, true].map((trip) =>
  [false, true].map((dot) => [...rateDivisions(trip, dot)].reverse())
);
const isTimeKnob = (knob: LfoKnob): knob is LfoTimeKnob => knob in DIVISION_KEYS;
const stepsOf = (knob: LfoKnob, { bpm, trip, dot }: LfoParams) =>
  !bpm || !isTimeKnob(knob) ? undefined : knob === 'rate' ? RATE_STEPS[+trip][+dot] : TIME_DIVISIONS;
const formatDivision = (division: number) => TEMPO_DIVISIONS[division]?.id ?? '';
const DIVISION_DEFAULTS: Record<LfoTimeKnob, number> = {
  rate: LFO_DEFAULTS.div,
  delay: DIVISION_OFF,
  rise: DIVISION_OFF,
};

// memoized: a drag of a point of the chart renders the section on every move, not its knobs. In BPM (`steps`) a time
// knob is a division of them
const LfoKnobHandle = React.memo(
  ({ id, knob, value, steps }: { id: LfoId; knob: LfoKnob; value: number; steps?: number[] }) => {
    const [, { setLfoValue, setDivision }] = useLfos();
    const modulation = useKnobModulation(`${id}.${knob}`);
    const rate = knob === 'rate';
    if (steps && isTimeKnob(knob))
      return (
        <Handle
          label={KNOBS[knob].label}
          name={KNOBS[knob].name}
          min={0}
          max={DIVISION_MAX}
          step={steps}
          precision={1}
          value={value}
          formatValue={formatDivision}
          defaultValue={DIVISION_DEFAULTS[knob]}
          onChange={(division) => setDivision(id, knob, division)}
          {...modulation}
        />
      );
    return (
      <Handle
        {...KNOBS[knob]}
        value={rate ? 1 / value : value}
        defaultValue={rate ? 1 / LFO_DEFAULTS.rate : LFO_DEFAULTS[knob]}
        onChange={(next) =>
          setLfoValue(id, knob, rate ? Math.min(LFO_RATE_MAX, Math.max(LFO_RATE_MIN, 1 / next)) : next)
        }
        {...modulation}
      />
    );
  }
);

// an LFO goes to every knob but those of the LFOs
const acceptsLfo = (target: string) => !isLfoKnob(target);

// LFO 1–4 right of ENV: their tabs (dragged onto a knob: a route), the cycle of the one shown with its points
// (edited there: a shape of its own, Custom) and the dot of the last note, its shape (by category: lfo-shapes.ts)
// and mode, BPM (Rate, Delay and Rise in divisions of the tempo), HOST (a free one on the beats of the transport:
// dimmed in Retrig, where it changes nothing), TRIP and DOT (the triplets and the dotted ones of Rate in BPM), Rate, Delay, Rise, Smooth and Phase (targets of the
// envelopes and the velocity)
export const LfoSection = () => {
  const [{ $lfos, $selected }, { select, setShape, setPoints, setMode, setBpm, setHost, setTrip, setDot }] =
    useLfos();
  const lfos = useBehaviorSubject($lfos);
  const id = useBehaviorSubject($selected);
  const lfo = lfos[id];
  const shape = shapeOptionOf(lfo);
  // a shape of the LFO, or the points of one of the list
  const chooseShape = (value: string) => {
    const option = LFO_SHAPE_OPTIONS.find((option) => option.id === value);
    if (!option) return;
    if ('points' in option) setPoints(id, option.points);
    else setShape(id, option.shape);
  };
  return (
    <Section
      plain
      name={<SourceTabs label='LFOs' sources={LFOS} shown={id} onSelect={select} accepts={acceptsLfo} />}
    >
      <Root>
        <LfoChart id={id} lfo={lfo} onPointsChange={(points) => setPoints(id, points)} />
        <Row>
          <Select
            value={shape}
            options={shape === CUSTOM_SHAPE ? SHAPES_CUSTOM : SHAPES}
            onChange={chooseShape}
          />
          <Select value={lfo.mode} options={MODES} onChange={(mode) => setMode(id, mode)} />
          <Keys>
            <SwitchKey label='BPM' name='Tempo sync' on={lfo.bpm} onChange={(on) => setBpm(id, on)} />
            <SwitchKey
              label='HOST'
              name='On the beats'
              on={lfo.host}
              disabled={lfo.mode !== 'free'}
              onChange={(on) => setHost(id, on)}
            />
            <SwitchKey
              label='T'
              name='Triplets'
              on={lfo.trip}
              disabled={!lfo.bpm}
              onChange={(on) => setTrip(id, on)}
            />
            <SwitchKey
              label='D'
              name='Dotted'
              on={lfo.dot}
              disabled={!lfo.bpm}
              onChange={(on) => setDot(id, on)}
            />
          </Keys>
        </Row>
        <Knobs>
          {(Object.keys(KNOBS) as LfoKnob[]).map((knob) => {
            const steps = stepsOf(knob, lfo);
            const value = steps && isTimeKnob(knob) ? lfo[DIVISION_KEYS[knob]] : lfo[knob];
            return <LfoKnobHandle key={knob} id={id} knob={knob} value={value} steps={steps} />;
          })}
        </Knobs>
      </Root>
    </Section>
  );
};
