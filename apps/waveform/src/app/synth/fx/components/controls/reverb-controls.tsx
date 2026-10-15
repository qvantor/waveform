import React from 'react';
import styled from 'styled-components';
import { reverb } from '../../effects/reverb';
import { ReverbParam } from '../../effects/reverb-presets';
import { ControlsGroup, LastGroups } from './group';
import { ParamHandle } from './param-handle';
import { ParamSwitch } from './param-switch';
import { ReverbDecayChart } from './reverb-decay-chart';
import { ERA_ICONS } from './reverb-era-icons';
import { FxControlsProps } from './types';

// narrower on phones (--fx-chart-width), shrinks when the group doesn't fit the panel
const Chart = styled(ReverbDecayChart)`
  flex-shrink: 1;
  width: var(--fx-chart-width, 160px);
  min-width: 96px;
  height: 80px;
`;

const { params: defs } = reverb;

// the era (color of the input stage), then the sections, left to right:
// input | time | decay (chart) | levels (faders: er, sep, mod); the wet level is the common mix of FxPanel,
// which also lays the groups out (many knobs: they wrap on narrow screens)
export const ReverbControls = ({ params, setParam, on, sampleRate, out }: FxControlsProps) => {
  const handle = (key: Exclude<ReverbParam, 'era'>) => (
    <ParamHandle
      def={defs[key]}
      value={params[key]}
      onChange={(value) => setParam(key, value)}
      disabled={!on}
    />
  );
  return (
    <>
      <ControlsGroup caption='Era' disabled={!on}>
        <ParamSwitch
          def={defs.era}
          icons={ERA_ICONS}
          value={params['era']}
          onChange={(value) => setParam('era', value)}
          disabled={!on}
        />
      </ControlsGroup>
      <ControlsGroup caption='Input' disabled={!on}>
        {handle('lowcut')}
      </ControlsGroup>
      <ControlsGroup caption='Time' disabled={!on}>
        {handle('pre')}
        {handle('size')}
      </ControlsGroup>
      <ControlsGroup caption='Decay' disabled={!on}>
        <Chart
          size={params['size']}
          decay={params['decay']}
          damp={params['damp']}
          bass={params['bass']}
          sampleRate={sampleRate}
          active={on}
        />
        {handle('decay')}
        {handle('damp')}
        {handle('bass')}
      </ControlsGroup>
      <LastGroups>
        <ControlsGroup caption='Levels' disabled={!on}>
          {handle('er')}
          {handle('sep')}
          {handle('depth')}
        </ControlsGroup>
        {out}
      </LastGroups>
    </>
  );
};
