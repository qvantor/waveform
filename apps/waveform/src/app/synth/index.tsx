import React from 'react';
import styled from 'styled-components';
import { PianoKeyboard, VolumeAnalyser, FqAnalyser, TapeSwitch, theme, useIsMobile } from '@waveform/ui-kit';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { DEFAULT_WAVETABLE_PATH } from '@waveform/preset-schema';
import { useApp } from '../app';
import { Header } from '../common/components';
import { PresetPanel, PresetsProvider } from '../presets';
import {
  SynthProvider,
  InputControllerProvider,
  useInputController,
  AdsrEnvelopeProvider,
  useAdsrEnvelope,
  Oscillator1Provider,
  Oscillator2Provider,
  useOscillator1,
  useOscillator2,
  KeyboardControllerProvider,
  SynthCoreProvider,
  useSynthCore,
  MidiControllerProvider,
} from './common/modules';
import { FilterProvider, FilterSection } from './filter';
import { OscillatorsContainer, MasterHandle } from './synth/components';
import { VoicingSection } from './voicing';
import { Settings } from './settings';
import { EnvelopeSection } from './envelope';
import { MobileLayout } from './mobile';
import { FxScreen, FxProvider } from './fx';
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

const HeaderContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

// exactly the right half of the screen: 50% of the header content box + its 10px right padding
const HeaderRight = styled.div`
  flex: 0 0 50%;
  align-self: stretch;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 20px;
`;

const HeaderPresetPanel = styled(PresetPanel)`
  flex: 1 1 auto;
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

const Internal = () => {
  const isMobile = useIsMobile();
  // lives above the layout switch, so the selected screen survives crossing the mobile breakpoint
  const [screen, setScreen] = React.useState<SynthScreen>('osc');
  const app = useApp();
  const synthCore = useSynthCore();
  const inputController = useInputController();
  const adsrEnvelope = useAdsrEnvelope();
  const oscillator1 = useOscillator1();
  const oscillator2 = useOscillator2();

  return (
    <MidiControllerProvider initial={{}} inputController={inputController}>
      <FilterProvider initial={{}} synthCore={synthCore}>
        <FxProvider initial={{}} synthCore={synthCore}>
          <KeyboardControllerProvider initial={{}} app={app} inputController={inputController}>
            <SynthProvider
              initial={{}}
              inputController={inputController}
              adsrEnvelope={adsrEnvelope}
              oscillator={[oscillator1, oscillator2]}
              synthCore={synthCore}
            >
              <PresetsProvider initial={{}}>
                {isMobile ? (
                  <MobileLayout screen={screen} onScreenChange={setScreen} />
                ) : (
                  <DesktopLayout screen={screen} onScreenChange={setScreen} />
                )}
              </PresetsProvider>
            </SynthProvider>
          </KeyboardControllerProvider>
        </FxProvider>
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
  const [{ audioCtx, masterGain }] = useSynthCore();
  return (
    <Header>
      <HeaderEq audioCtx={audioCtx} master={masterGain} />
      <HeaderRight>
        <TapeSwitch options={SYNTH_SCREENS} value={screen} onChange={onScreenChange} />
        <HeaderPresetPanel />
        <HeaderContainer>
          <Settings />
          <MasterHandle />
          <VolumeAnalyser audioCtx={audioCtx} master={masterGain} />
        </HeaderContainer>
      </HeaderRight>
    </Header>
  );
};

export default () => (
  <InputControllerProvider initial={{}}>
    <SynthCoreProvider initial={{}}>
      <AdsrEnvelopeProvider initial={{}}>
        <OscillatorInternal>
          <Internal />
        </OscillatorInternal>
      </AdsrEnvelopeProvider>
    </SynthCoreProvider>
  </InputControllerProvider>
);
