import React from 'react';
import styled from 'styled-components';
import { PianoKeyboard, VolumeAnalyser, FqAnalyser, TapeSwitch, theme, useIsMobile } from '@waveform/ui-kit';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { DEFAULT_WAVETABLE_PATH } from '@waveform/preset-schema';
import { useApp } from '../app';
import { Header, HeaderSection } from '../common/components';
import { PresetSection, PresetsProvider } from '../presets';
import { PerfHook } from '../perf/perf-hook';
import {
  SynthProvider,
  useSynth,
  InputControllerProvider,
  useInputController,
  EnvelopesProvider,
  useEnvelopes,
  ModulationProvider,
  useModulation,
  Oscillator1Provider,
  Oscillator2Provider,
  useOscillator1,
  useOscillator2,
  KeyboardControllerProvider,
  SynthCoreProvider,
  useSynthCore,
  MidiControllerProvider,
  SoundSwitchProvider,
  useSoundSwitch,
} from './common/modules';
import { FilterProvider, FilterSection, useFilter } from './filter';
import { OscillatorsContainer, MasterHandle } from './synth/components';
import { VoicingSection } from './voicing';
import { MidiInput, SettingsButton } from './settings';
import { EnvelopeSection } from './envelope';
import { MobileLayout } from './mobile';
import { FxScreen, FxProvider, useFx } from './fx';
import { SYNTH_SCREENS, SynthScreen } from './screens';

const Root = styled.div`
  display: grid;
  grid-template-rows: 1fr 1fr 110px;
  height: calc(100vh - 80px);
  gap: 1px;
  background: ${theme.colors.primaryLowContrast};
`;

const AdsrContainer = styled.div`
  display: grid;
  grid-template-columns: 3fr 3fr 1fr;
  background: ${theme.colors.primaryLowContrast};
  gap: 1px;
`;

const PianoContainer = styled.div`
  display: flex;
  justify-content: center;
`;

// exactly the right half of the screen: 50% of the header content box + its 10px right padding;
// split into full-height sections: tabs | preset | master
const HeaderRight = styled.div`
  flex: 0 0 50%;
  align-self: stretch;
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  margin-right: -10px; // reach the right edge, cancels the Header padding
`;

// the tape switch's dark groove already separates the tabs, only master needs a divider
const MasterSection = styled(HeaderSection)`
  gap: 12px;
  padding: 0 16px;
`;

const DesktopFx = styled(FxScreen)`
  grid-row: span 2;
`;

const HeaderEq = styled(FqAnalyser)`
  flex: 1 1;
  height: 100%;
  margin-left: -20px; // stick to the logo, cancels Header gap
`;

const PianoInternal = () => {
  const [{ $pressed }, { onPress, onRelease }] = useInputController();
  const pressed = useBehaviorSubject($pressed);
  return (
    <PianoContainer>
      <PianoKeyboard onPress={onPress} onRelease={onRelease} pressed={pressed} />
    </PianoContainer>
  );
};

const AdsrEnvelopeInternal = () => {
  return (
    <AdsrContainer>
      <EnvelopeSection />
      <FilterSection />
      <VoicingSection />
    </AdsrContainer>
  );
};

interface ScreenProps {
  screen: SynthScreen;
  onScreenChange: (screen: SynthScreen) => void;
}

const DesktopLayout = ({ screen, onScreenChange }: ScreenProps) => (
  <>
    <HeaderInternal screen={screen} onScreenChange={onScreenChange} />
    <Root>
      {screen === 'osc' ? (
        <>
          <OscillatorsContainer />
          <AdsrEnvelopeInternal />
        </>
      ) : (
        <DesktopFx />
      )}
      <PianoInternal />
    </Root>
  </>
);

// a preset switch silences the voices, the fx and the output until the next preset can play
const SoundSwitchInternal = ({ children }: React.PropsWithChildren) => {
  const synthCore = useSynthCore();
  const synth = useSynth();
  const fx = useFx();
  const oscillator1 = useOscillator1();
  const oscillator2 = useOscillator2();
  return (
    <SoundSwitchProvider
      initial={undefined}
      synthCore={synthCore}
      synth={synth}
      fx={fx}
      oscillator={[oscillator1, oscillator2]}
    >
      {children}
    </SoundSwitchProvider>
  );
};

// the fx follow the envelopes of the last note of the synth
const FxInternal = ({ children }: React.PropsWithChildren) => {
  const synthCore = useSynthCore();
  const synth = useSynth();
  const modulation = useModulation();
  return (
    <FxProvider initial={{}} synthCore={synthCore} synth={synth} modulation={modulation}>
      <SoundSwitchInternal>{children}</SoundSwitchInternal>
    </FxProvider>
  );
};

// a preset is applied through the sound switch
const PresetsInternal = ({ children }: React.PropsWithChildren) => {
  const soundSwitch = useSoundSwitch();
  return (
    <PresetsProvider initial={{}} soundSwitch={soundSwitch}>
      {children}
    </PresetsProvider>
  );
};

// the voices: the filter is in each of them, the fx follow the last note
const VoicesInternal = ({ children }: React.PropsWithChildren) => {
  const synthCore = useSynthCore();
  const inputController = useInputController();
  const envelopes = useEnvelopes();
  const modulation = useModulation();
  const oscillator1 = useOscillator1();
  const oscillator2 = useOscillator2();
  const filter = useFilter();
  return (
    <SynthProvider
      initial={{}}
      inputController={inputController}
      envelopes={envelopes}
      modulation={modulation}
      oscillator={[oscillator1, oscillator2]}
      filter={filter}
      synthCore={synthCore}
    >
      <FxInternal>{children}</FxInternal>
    </SynthProvider>
  );
};

const Internal = () => {
  const isMobile = useIsMobile();
  // lives above the layout switch, so the selected screen survives crossing the mobile breakpoint
  const [screen, setScreen] = React.useState<SynthScreen>('osc');
  const app = useApp();
  const synthCore = useSynthCore();
  const inputController = useInputController();

  return (
    <MidiControllerProvider initial={{}} inputController={inputController}>
      <FilterProvider initial={{}} synthCore={synthCore}>
        <VoicesInternal>
          <KeyboardControllerProvider initial={{}} app={app} inputController={inputController}>
            <PresetsInternal>
              {/* nothing but in the perf build (scripts/bench-perf): above the layout switch, never remounted */}
              <PerfHook />
              {isMobile ? (
                <MobileLayout screen={screen} onScreenChange={setScreen} />
              ) : (
                <DesktopLayout screen={screen} onScreenChange={setScreen} />
              )}
            </PresetsInternal>
          </KeyboardControllerProvider>
        </VoicesInternal>
      </FilterProvider>
    </MidiControllerProvider>
  );
};

const OscillatorInternal = ({ children }: React.PropsWithChildren) => {
  const synthCore = useSynthCore();
  return (
    <Oscillator1Provider
      initial={{ initialWavePath: DEFAULT_WAVETABLE_PATH, active: true }}
      synthCore={synthCore}
    >
      <Oscillator2Provider
        initial={{ initialWavePath: DEFAULT_WAVETABLE_PATH, active: false }}
        synthCore={synthCore}
      >
        {children}
      </Oscillator2Provider>
    </Oscillator1Provider>
  );
};

const HeaderInternal = ({ screen, onScreenChange }: ScreenProps) => {
  const [{ audioCtx, output }] = useSynthCore();
  return (
    <Header>
      <HeaderEq audioCtx={audioCtx} master={output} />
      <HeaderRight>
        <TapeSwitch options={SYNTH_SCREENS} value={screen} onChange={onScreenChange} switchOnDrag />
        <PresetSection
          actions={
            <>
              <MidiInput />
              <SettingsButton />
            </>
          }
        />
        <MasterSection>
          <MasterHandle />
          <VolumeAnalyser audioCtx={audioCtx} master={output} />
        </MasterSection>
      </HeaderRight>
    </Header>
  );
};

export default () => (
  <InputControllerProvider initial={{}}>
    <SynthCoreProvider initial={{}}>
      <EnvelopesProvider initial={{}}>
        <ModulationProvider initial={{}}>
          <OscillatorInternal>
            <Internal />
          </OscillatorInternal>
        </ModulationProvider>
      </EnvelopesProvider>
    </SynthCoreProvider>
  </InputControllerProvider>
);
