import React from 'react';
import styled from 'styled-components';
import cls from 'classnames';
import { Radio } from 'antd';
import { TapeSwitch, theme } from '@waveform/ui-kit';
import { HeaderSection } from '../../common/components';
import { PresetSection } from '../../presets';
import { MidiInput } from '../settings';
import { MasterHandle } from '../synth/components';
import { SYNTH_SCREENS, SynthScreen } from '../screens';

export type MobileMode = 'synth' | 'keys';

// full-height sections like on desktop: logo | tabs | preset | mode | master;
// portrait: logo and mode on top, tabs and preset below, master through both rows
const Root = styled.div`
  border-bottom: 1px solid ${theme.colors.primaryLowContrast};
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) auto auto;
  grid-template-rows: 48px;
  grid-template-areas: 'logo tabs presets mode master';

  &.portrait {
    grid-template-columns: auto minmax(0, 1fr) auto auto;
    grid-template-rows: auto 50px;
    grid-template-areas:
      'logo logo mode master'
      'tabs presets presets master';
  }
`;

const Logo = styled.a`
  grid-area: logo;
  align-self: center;
  padding: 0 10px;
  text-decoration: none;
  font-size: 18px;
  font-weight: 700;
  background: -webkit-linear-gradient(45deg, ${theme.colors.secondAccent}, ${theme.colors.accent} 80%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
`;

const Tabs = styled.div`
  grid-area: tabs;
  display: flex;
  --tape-key-width: 52px;
  --tape-key-padding: 8px 0 10px;

  .portrait > & {
    --tape-key-padding: 7px 0 9px;
  }
`;

// the tape switch's dark groove already separates it from the tabs
const Presets = styled(PresetSection)`
  grid-area: presets;
`;

const Mode = styled.div`
  grid-area: mode;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 8px;
  border-left: 1px solid ${theme.colors.primaryLowContrast};

  // in portrait it shares the top row with the logo, above the preset section
  .portrait > & {
    padding: 4px 8px;
    border-left: none;
  }
`;

const Master = styled(HeaderSection)`
  grid-area: master;
  padding: 0 10px;
`;

// separates the portrait top row from the sections below
const TopRowLine = styled.div`
  grid-row: 1;
  grid-column: 1 / 4;
  align-self: end;
  height: 1px;
  background: ${theme.colors.primaryLowContrast};
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
    <Presets actions={<MidiInput />} />
    <Mode>
      <Radio.Group
        options={modeOptions}
        optionType='button'
        buttonStyle='solid'
        value={mode}
        onChange={(e) => onModeChange(e.target.value)}
      />
    </Mode>
    {portrait && <TopRowLine />}
    <Master>
      <MasterHandle label={null} />
    </Master>
  </Root>
);
