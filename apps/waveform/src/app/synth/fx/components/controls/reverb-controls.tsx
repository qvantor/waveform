import React from 'react';
import styled from 'styled-components';
import { reverb } from '../../effects/reverb';
import { ReverbParam } from '../../effects/reverb-presets';
import { ControlsGroup } from './group';
import { ParamHandle } from './param-handle';
import { ParamSwitch } from './param-switch';
import { ReverbDecayChart } from './reverb-decay-chart';
import { ERA_ICONS } from './reverb-era-icons';
import { FxControlsProps } from './types';

// many knobs: the groups wrap on narrow screens
const Root = styled.div`
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  row-gap: 10px;
`;

const Chart = styled(ReverbDecayChart)`
  width: 160px;
  height: 80px;
`;

const { params: defs } = reverb;

// the era (color of the input stage), then the sections, left to right:
// input | time | decay (chart) | levels (faders: er, sep, mod); the wet level is the common mix of FxPanel
export const ReverbControls = ({ params, setParam, on, sampleRate }: FxControlsProps) => {
  const handle = (key: Exclude<ReverbParam, 'era'>) => (
    <ParamHandle
      def={defs[key]}
      value={params[key]}
      onChange={(value) => setParam(key, value)}
      disabled={!on}
    />
  );
  return (
    <Root>
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
      <ControlsGroup caption='Levels' disabled={!on}>
        {handle('er')}
        {handle('sep')}
        {handle('depth')}
      </ControlsGroup>
    </Root>
  );
};
