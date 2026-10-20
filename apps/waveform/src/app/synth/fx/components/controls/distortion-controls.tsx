import React from 'react';
import styled from 'styled-components';
import { distortion } from '../../effects/distortion';
import { DistortionParam } from '../../effects/distortion-presets';
import { KnobModulation, useKnobModulation } from '../../../modulation/use-knob-modulation';
import { DistortionCurveChart } from './distortion-curve-chart';
import { DISTORTION_MODE_ICONS } from './distortion-mode-icons';
import { ControlsGroup, groupChart, LastGroups } from './group';
import { ParamHandle } from './param-handle';
import { ParamSwitch } from './param-switch';
import { FxControlsProps } from './types';

const Chart = styled(DistortionCurveChart)`
  ${groupChart}
`;

const { params: defs } = distortion;

// three groups left to right: mode | drive (the curve, drive) | post (tone, level: a trim on top of the
// makeup gain of the drive); the wet level against the dry one is the common mix of FxPanel, which lays the
// groups out
export const DistortionControls = ({ params, setParam, on, out }: FxControlsProps) => {
  // the knob of the curve: it follows where its routes move it
  const charted: Partial<Record<DistortionParam, KnobModulation>> = {
    drive: useKnobModulation('distortion.drive'),
  };
  const handle = (key: Exclude<DistortionParam, 'mode'>) => (
    <ParamHandle
      def={defs[key]}
      value={params[key]}
      onChange={(value) => setParam(key, value)}
      disabled={!on}
      target={`distortion.${key}`}
      modulation={charted[key]}
    />
  );
  return (
    <>
      <ControlsGroup caption='Mode' disabled={!on}>
        <ParamSwitch
          def={defs.mode}
          icons={DISTORTION_MODE_ICONS}
          value={params['mode']}
          onChange={(value) => setParam('mode', value)}
          disabled={!on}
        />
      </ControlsGroup>
      <ControlsGroup caption='Drive' disabled={!on}>
        <Chart
          mode={params['mode']}
          drive={params['drive']}
          active={on}
          modulations={charted.drive?.modulations}
        />
        {handle('drive')}
      </ControlsGroup>
      <LastGroups>
        <ControlsGroup caption='Post' disabled={!on}>
          {handle('tone')}
          {handle('level')}
        </ControlsGroup>
        {out}
      </LastGroups>
    </>
  );
};
