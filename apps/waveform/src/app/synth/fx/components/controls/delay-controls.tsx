import React from 'react';
import styled from 'styled-components';
import { FilterResponse, Handle, SwitchKey } from '@waveform/ui-kit';
import { TEMPO_DIVISIONS } from '@waveform/preset-schema';
import { delay, delayDivisionOf, delayStepsOf } from '../../effects/delay';
import { KnobModulation, useKnobModulation } from '../../../modulation/use-knob-modulation';
import { NormalIcon, PingPongIcon } from './delay-mode-icons';
import { ControlsGroup, groupChart, LastGroups } from './group';
import { ParamHandle } from './param-handle';
import { ParamSwitch } from './param-switch';
import { FxControlsProps } from './types';

const Chart = styled(FilterResponse)`
  ${groupChart}
`;

const { params: defs } = delay;

// the switch of the mode, BPM, TRIP and DOT under it
const ModeColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const Keys = styled.div`
  height: 18px;
  display: flex;
  gap: 2px;
`;

const formatDivision = (division: number) => TEMPO_DIVISIONS[division]?.id ?? '';

// Time in BPM: its divisions (1/64 … 1 bar, by TRIP and DOT), right longer; its routes those of Time
const TimeDivision = ({
  params,
  setParam,
  disabled,
}: Pick<FxControlsProps, 'params' | 'setParam'> & { disabled: boolean }) => {
  const modulation = useKnobModulation('delay.time');
  return (
    <Handle
      label={defs.time.label}
      name={defs.time.name}
      min={0}
      max={defs.div.max}
      step={delayStepsOf(params)}
      precision={1}
      value={delayDivisionOf(params)}
      formatValue={formatDivision}
      defaultValue={defs.div.default}
      onChange={(division) => setParam('div', division)}
      disabled={disabled}
      {...modulation}
    />
  );
};

const MODE_ICONS: Record<string, React.ReactNode> = { normal: <NormalIcon />, 'ping-pong': <PingPongIcon /> };

// three groups left to right: mode (BPM, TRIP, DOT under it) | pan, time, feedback | bandpass (chart, freq, q);
// FxPanel lays them out. In BPM Time is a division of the tempo
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
        <ModeColumn>
          <ParamSwitch
            def={defs.mode}
            icons={MODE_ICONS}
            value={params['mode']}
            onChange={(value) => setParam('mode', value)}
            disabled={!on}
          />
          <Keys>
            <SwitchKey
              label='BPM'
              name='Tempo sync'
              on={sync}
              disabled={!on}
              onChange={(value) => setParam('sync', +value)}
            />
            <SwitchKey
              label='T'
              name='Triplets'
              on={params['trip'] >= 0.5}
              disabled={!on || !sync}
              onChange={(value) => setParam('trip', +value)}
            />
            <SwitchKey
              label='D'
              name='Dotted'
              on={params['dot'] >= 0.5}
              disabled={!on || !sync}
              onChange={(value) => setParam('dot', +value)}
            />
          </Keys>
        </ModeColumn>
      </ControlsGroup>
      <ControlsGroup caption='Echo' disabled={!on}>
        {handle('pan')}
        {sync ? <TimeDivision params={params} setParam={setParam} disabled={!on} /> : handle('time')}
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
