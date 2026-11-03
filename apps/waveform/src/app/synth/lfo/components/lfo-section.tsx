import React from 'react';
import { styled } from 'styled-components';
import { AnchorIcon, formatTime, Handle, Section, Select, SwitchKey, SwitchKeys } from '@waveform/ui-kit';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import {
  DIVISION_MAX,
  DIVISION_OFF,
  divisionSeconds,
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
  TEMPO_DIVISIONS,
  TIME_DIVISIONS,
} from '@waveform/preset-schema';
import { NoteValueKeys } from '../../../common/components';
import { useLfos } from '../../common/modules';
import { DIVISION_KEYS, lfoDivision, LfoParams, LfoTimeKnob, rateStepsAt } from '../../common/modules/lfos';
import { useKnobModulation } from '../../modulation/use-knob-modulation';
import { useStepTravel, useTempo } from '../../modulation/step-travel';
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
// and DOT, those of its steps at the tempo (`rateSteps`: as long as LFO_RATE_MIN at least), the times right longer
// from Off; the default 1/4 and Off
const isTimeKnob = (knob: LfoKnob): knob is LfoTimeKnob => knob in DIVISION_KEYS;
const stepsOf = (knob: LfoKnob, { bpm }: LfoParams, rateSteps: number[]) =>
  !bpm || !isTimeKnob(knob) ? undefined : knob === 'rate' ? rateSteps : TIME_DIVISIONS;
const formatDivision = (division: number) => TEMPO_DIVISIONS[division]?.id ?? '';
const DIVISION_DEFAULTS: Record<LfoTimeKnob, number> = {
  rate: LFO_DEFAULTS.div,
  delay: DIVISION_OFF,
  rise: DIVISION_OFF,
};

// a division in the units of its knob at a tempo, as the LFO plays it (lfoSeconds): Rate the frequency, Delay and
// Rise seconds
const rateOf = (division: number, bpm: number) => 1 / divisionSeconds(division, bpm);
const DIVISION_VALUES: Record<LfoTimeKnob, (division: number, bpm: number) => number> = {
  rate: rateOf,
  delay: divisionSeconds,
  rise: divisionSeconds,
};

// a time knob in BPM: a division of `steps`; its routes move it in the units of HZ, their arc and mark on its steps
// at the tempo
const LfoDivisionHandle = ({
  id,
  knob,
  value,
  steps,
}: {
  id: LfoId;
  knob: LfoTimeKnob;
  value: number;
  steps: number[];
}) => {
  const [, { setDivision }] = useLfos();
  const target = `${id}.${knob}`;
  const modulation = useKnobModulation(target);
  const modTravel = useStepTravel(target, steps, value, DIVISION_VALUES[knob]);
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
      modTravel={modTravel}
      {...modulation}
    />
  );
};

// memoized: a drag of a point of the chart renders the section on every move, not its knobs. In BPM (`steps`) a time
// knob is a division of them
const LfoKnobHandle = React.memo(
  ({ id, knob, value, steps }: { id: LfoId; knob: LfoKnob; value: number; steps?: number[] }) => {
    const [, { setLfoValue }] = useLfos();
    const modulation = useKnobModulation(`${id}.${knob}`);
    const rate = knob === 'rate';
    if (steps && isTimeKnob(knob))
      return <LfoDivisionHandle id={id} knob={knob} value={value} steps={steps} />;
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

const ANCHOR = <AnchorIcon />;

// the keys of the tempo, memoized as the knobs are
const TempoKeys = React.memo(
  ({ id, free, ...lfo }: { id: LfoId; free: boolean } & Record<'bpm' | 'host' | 'trip' | 'dot', boolean>) => {
    const [, { setBpm, setHost, setTrip, setDot }] = useLfos();
    return (
      <SwitchKeys aria-label='Tempo'>
        <SwitchKey
          label='BPM'
          name='Tempo sync'
          hint='Rate, Delay and Rise in note values'
          on={lfo.bpm}
          onChange={(on) => setBpm(id, on)}
        />
        <SwitchKey
          icon={ANCHOR}
          name='Anchor to the beats'
          hint='Keeps the cycle on the beats of the tempo'
          disabledHint='Only in Free mode'
          on={lfo.host}
          disabled={!free}
          onChange={(on) => setHost(id, on)}
        />
        <NoteValueKeys
          of='Rate'
          bpm={lfo.bpm}
          trip={lfo.trip}
          dot={lfo.dot}
          onTrip={(on) => setTrip(id, on)}
          onDot={(on) => setDot(id, on)}
        />
      </SwitchKeys>
    );
  }
);

// an LFO goes to every knob but those of the LFOs
const acceptsLfo = (target: string) => !isLfoKnob(target);

// LFO 1–4 right of ENV: their tabs (dragged onto a knob: a route), the cycle of the one shown with its points
// (edited there: a shape of its own, Custom) and the dot of the last note, its shape (by category: lfo-shapes.ts)
// and mode, the keys of the tempo on one plate (each with a tooltip): BPM (Rate, Delay and Rise in divisions of the
// tempo), the anchor (HOST: a free one on the beats of the transport, dimmed in Retrig, where it changes nothing),
// the triplets and the dotted ones of Rate in BPM; Rate, Delay, Rise, Smooth and Phase (targets of the envelopes and
// the velocity)
export const LfoSection = () => {
  const [{ $lfos, $selected }, { select, setShape, setPoints, setMode }] = useLfos();
  const lfos = useBehaviorSubject($lfos);
  const id = useBehaviorSubject($selected);
  const lfo = lfos[id];
  const tempo = useTempo();
  // the steps of Rate at the tempo, right faster (the same steps: the same array, the knob is memoized)
  const fitting = rateStepsAt(lfo, tempo);
  const rateSteps = React.useMemo(() => [...fitting].reverse(), [fitting]);
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
          <TempoKeys
            id={id}
            free={lfo.mode === 'free'}
            bpm={lfo.bpm}
            host={lfo.host}
            trip={lfo.trip}
            dot={lfo.dot}
          />
        </Row>
        <Knobs>
          {(Object.keys(KNOBS) as LfoKnob[]).map((knob) => {
            const steps = stepsOf(knob, lfo, rateSteps);
            // Rate the division it plays at the tempo (its own may be shorter there)
            const value =
              steps && isTimeKnob(knob)
                ? knob === 'rate'
                  ? lfoDivision(lfo, tempo)
                  : lfo[DIVISION_KEYS[knob]]
                : lfo[knob];
            return <LfoKnobHandle key={knob} id={id} knob={knob} value={value} steps={steps} />;
          })}
        </Knobs>
      </Root>
    </Section>
  );
};
