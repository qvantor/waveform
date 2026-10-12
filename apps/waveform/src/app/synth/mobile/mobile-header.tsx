import React from 'react';
import styled from 'styled-components';
import cls from 'classnames';
import { Radio } from 'antd';
import { TapeSwitch, theme } from '@waveform/ui-kit';
import { PresetPanel } from '../../presets';
import { Settings } from '../settings';
import { MasterHandle } from '../synth/components';
import { SYNTH_SCREENS, SynthScreen } from '../screens';

export type MobileMode = 'synth' | 'keys';

const Root = styled.div`
  border-bottom: 1px solid ${theme.colors.primaryLowContrast};
  padding: 4px 8px;
  display: grid;
  align-items: center;
  column-gap: 10px;
  row-gap: 4px;
  grid-template-columns: auto auto minmax(0, 1fr) auto auto auto;
  grid-template-areas: 'logo tabs presets mode settings master';

  &.portrait {
    grid-template-columns: auto minmax(0, 1fr) auto auto;
    grid-template-areas:
      'logo mode settings master'
      'tabs presets presets master';
  }
`;

const Logo = styled.a`
  grid-area: logo;
  text-decoration: none;
  font-size: 18px;
  font-weight: 700;
  background: -webkit-linear-gradient(45deg, ${theme.colors.secondAccent}, ${theme.colors.accent} 80%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
`;

// full header height (cancels the vertical padding); in portrait only the second row, down to the bottom edge
const Tabs = styled.div`
  grid-area: tabs;
  align-self: stretch;
  display: flex;
  margin: -4px 0;
  --tape-key-width: 52px;
  --tape-key-padding: 8px 0 10px;

  .portrait > & {
    height: 50px;
    margin-top: 0;
    --tape-key-padding: 7px 0 9px;
  }
`;

const Presets = styled(PresetPanel)`
  grid-area: presets;
`;

const Mode = styled.div`
  grid-area: mode;
  justify-self: end;
`;

const SettingsArea = styled.div`
  grid-area: settings;
`;

const Master = styled.div`
  grid-area: master;
`;

const modeOptions = [
  { label: 'Synth', value: 'synth' },
  { label: 'Keys', value: 'keys' },
];

interface Props {
  portrait: boolean;
  mode: MobileMode;
  onModeChange: (mode: MobileMode) => void;
  screen: SynthScreen;
  onScreenChange: (screen: SynthScreen) => void;
}

export const MobileHeader = ({ portrait, mode, onModeChange, screen, onScreenChange }: Props) => (
  <Root className={cls({ portrait })}>
    <Logo href='https://github.com/qvantor/waveform' target='_blank' referrerPolicy='no-referrer'>
      WAVEFORM
    </Logo>
    <Tabs>
      <TapeSwitch options={SYNTH_SCREENS} value={screen} onChange={onScreenChange} />
    </Tabs>
    <Presets />
    <Mode>
      <Radio.Group
        options={modeOptions}
        optionType='button'
        buttonStyle='solid'
        value={mode}
        onChange={(e) => onModeChange(e.target.value)}
      />
    </Mode>
    <SettingsArea>
      <Settings />
    </SettingsArea>
    <Master>
      <MasterHandle label={null} />
    </Master>
  </Root>
);
