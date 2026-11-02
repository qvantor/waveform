import React from 'react';
import styled from 'styled-components';
import { FilterResponse, Handle, SwitchKey, SwitchKeys } from '@waveform/ui-kit';
import { TEMPO_DIVISIONS } from '@waveform/preset-schema';
import { NoteValueKeys } from '../../../../common/components';
import { delay, delayDivisionOf, delayDivisionSeconds, delayStepsOf } from '../../effects/delay';
import { KnobModulation, useKnobModulation } from '../../../modulation/use-knob-modulation';
import { useStepTravel } from '../../../modulation/step-travel';
import { NormalIcon, PingPongIcon } from './delay-mode-icons';
import { ControlsGroup, groupChart, LastGroups } from './group';
import { ParamHandle } from './param-handle';
import { ParamSwitch } from './param-switch';
import { FxControlsProps } from './types';

const Chart = styled(FilterResponse)`
  ${groupChart}
`;

const { params: defs } = delay;

// BPM over TRIP and DOT on one plate beside Time, as large as its ring (KNOB_RING, over its label: KNOB_LABEL), 4 px
// from it (the gap of the knobs is 10)
const KNOB_RING = 48;
const KNOB_LABEL = 15;
const Plate = styled(SwitchKeys)`
  width: ${KNOB_RING}px;
  height: ${KNOB_RING}px;
  margin: 0 0 ${KNOB_LABEL + 1}px -6px;
`;

// memoized: the controls render on every move of a knob, a key is a tooltip
const TempoKeys = React.memo(
  ({
    on,
    sync,
    trip,
    dot,
    setParam,
  }: Pick<FxControlsProps, 'on' | 'setParam'> & Record<'sync' | 'trip' | 'dot', boolean>) => (
    <Plate aria-label='Tempo' disabled={!on} disabledHint='Turn on the delay' stack>
      <SwitchKey
        label='BPM'
        name='Tempo sync'
        hint='Time in note values'
        on={sync}
        onChange={(value) => setParam('sync', +value)}
      />
      <NoteValueKeys
        of='Time'
        bpm={sync}
        trip={trip}
        dot={dot}
        onTrip={(value) => setParam('trip', +value)}
        onDot={(value) => setParam('dot', +value)}
      />
    </Plate>
  )
);

const formatDivision = (division: number) => TEMPO_DIVISIONS[division]?.id ?? '';

// Time in BPM: its divisions (1/64 … 1 bar, by TRIP and DOT), right longer; its routes those of Time (in seconds:
// their arc and mark on its steps at the tempo)
const TimeDivision = ({
  params,
  setParam,
  disabled,
}: Pick<FxControlsProps, 'params' | 'setParam'> & { disabled: boolean }) => {
  const modulation = useKnobModulation('delay.time');
  const steps = delayStepsOf(params);
  const division = delayDivisionOf(params);
  const modTravel = useStepTravel('delay.time', steps, division, delayDivisionSeconds);
  return (
    <Handle
      label={defs.time.label}
      name={defs.time.name}
      min={0}
      max={defs.div.max}
      step={steps}
      precision={1}
      value={division}
      modTravel={modTravel}
      formatValue={formatDivision}
      defaultValue={defs.div.default}
      onChange={(division) => setParam('div', division)}
      disabled={disabled}
      {...modulation}
    />
  );
};

const MODE_ICONS: Record<string, React.ReactNode> = { normal: <NormalIcon />, 'ping-pong': <PingPongIcon /> };

// three groups left to right: mode | pan, time (BPM over TRIP and DOT beside it), feedback | bandpass (chart, freq,
// q); FxPanel lays them out. In BPM Time is a division of the tempo
// the knobs of the bandpass on the chart
const RANGES = { cutoff: defs.freq, resonance: defs.q };

type DelayKnob = 'pan' | 'time' | 'fb' | 'freq' | 'q';

export const DelayControls = ({ params, setParam, on, sampleRate, out }: FxControlsProps) => {
  // the knobs of the chart: it follows where their routes move them
  const charted: Partial<Record<DelayKnob, KnobModulation>> = {
    freq: useKnobModulation('delay.freq'),
    q: useKnobModulation('delay.q'),
  };
  const sync = params['sync'] >= 0.5;
  const handle = (key: DelayKnob) => (
    <ParamHandle
      def={defs[key]}
      value={params[key]}
      onChange={(value) => setParam(key, value)}
      disabled={!on}
      target={`delay.${key}`}
      modulation={charted[key]}
    />
  );
  return (
    <>
      <ControlsGroup caption='Mode' disabled={!on}>
        <ParamSwitch
          def={defs.mode}
          icons={MODE_ICONS}
          value={params['mode']}
          onChange={(value) => setParam('mode', value)}
          disabled={!on}
        />
      </ControlsGroup>
      <ControlsGroup caption='Echo' disabled={!on}>
        {handle('pan')}
        {sync ? <TimeDivision params={params} setParam={setParam} disabled={!on} /> : handle('time')}
        <TempoKeys
          on={on}
          sync={sync}
          trip={params['trip'] >= 0.5}
          dot={params['dot'] >= 0.5}
          setParam={setParam}
        />
        {handle('fb')}
      </ControlsGroup>
      <LastGroups>
        <ControlsGroup caption='Filter' disabled={!on}>
          <Chart
            type='bandpass'
            cutoff={params['freq']}
            resonance={params['q']}
            sampleRate={sampleRate}
            active={on}
            ranges={RANGES}
            modulations={{ cutoff: charted.freq?.modulations, resonance: charted.q?.modulations }}
          />
          {handle('freq')}
          {handle('q')}
        </ControlsGroup>
        {out}
      </LastGroups>
    </>
  );
};
