import React from 'react';
import styled from 'styled-components';
import { FilterResponse, ModeSwitch } from '@waveform/ui-kit';
import { delay } from '../../effects/delay';
import { NormalIcon, PingPongIcon } from './delay-mode-icons';
import { ControlsGroup } from './group';
import { ParamHandle } from './param-handle';
import { FxControlsProps } from './types';

const Root = styled.div`
  display: flex;
  align-items: stretch;
`;

const Chart = styled(FilterResponse)`
  width: 160px;
  height: 80px;
`;

const { params: defs } = delay;

const MODE_ICONS: Record<string, React.ReactNode> = { normal: <NormalIcon />, 'ping-pong': <PingPongIcon /> };
const modeOptions = (defs.mode.options ?? []).map((option) => ({
  ...option,
  icon: MODE_ICONS[option.id],
}));

// three groups left to right: mode | pan, time, feedback | bandpass (chart, freq, q)
export const DelayControls = ({ params, setParam, on, sampleRate }: FxControlsProps) => {
  const handle = (key: 'pan' | 'time' | 'fb' | 'freq' | 'q') => (
    <ParamHandle
      def={defs[key]}
      value={params[key]}
      onChange={(value) => setParam(key, value)}
      disabled={!on}
    />
  );
  return (
    <Root>
      <ControlsGroup caption='Mode' disabled={!on}>
        <ModeSwitch
          options={modeOptions}
          value={modeOptions[Math.round(params['mode'])]?.id ?? modeOptions[0]?.id}
          onChange={(id) =>
            setParam(
              'mode',
              modeOptions.findIndex((option) => option.id === id)
            )
          }
          disabled={!on}
        />
      </ControlsGroup>
      <ControlsGroup caption='Echo' disabled={!on}>
        {handle('pan')}
        {handle('time')}
        {handle('fb')}
      </ControlsGroup>
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
    </Root>
  );
};
