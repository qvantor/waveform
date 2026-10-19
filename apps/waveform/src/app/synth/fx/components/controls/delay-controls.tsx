import React from 'react';
import styled from 'styled-components';
import { FilterResponse } from '@waveform/ui-kit';
import { delay } from '../../effects/delay';
import { NormalIcon, PingPongIcon } from './delay-mode-icons';
import { ControlsGroup, groupChart, LastGroups } from './group';
import { ParamHandle } from './param-handle';
import { ParamSwitch } from './param-switch';
import { FxControlsProps } from './types';

const Chart = styled(FilterResponse)`
  ${groupChart}
`;

const { params: defs } = delay;

const MODE_ICONS: Record<string, React.ReactNode> = { normal: <NormalIcon />, 'ping-pong': <PingPongIcon /> };

// three groups left to right: mode | pan, time, feedback | bandpass (chart, freq, q); FxPanel lays them out
export const DelayControls = ({ params, setParam, on, sampleRate, out }: FxControlsProps) => {
  const handle = (key: 'pan' | 'time' | 'fb' | 'freq' | 'q') => (
    <ParamHandle
      def={defs[key]}
      value={params[key]}
      onChange={(value) => setParam(key, value)}
      disabled={!on}
      target={`delay.${key}`}
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
        {handle('time')}
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
          />
          {handle('freq')}
          {handle('q')}
        </ControlsGroup>
        {out}
      </LastGroups>
    </>
  );
};
