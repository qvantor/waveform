import React from 'react';
import styled from 'styled-components';
import { PianoKeyboard, VolumeAnalyser, FqAnalyser, theme, useIsMobile } from '@waveform/ui-kit';
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

const DesktopLayout = () => (
  <>
    <HeaderInternal />
    <Root>
      <OscillatorsContainer />
      <AdsrEnvelopeInternal />
      <PianoInternal />
    </Root>
  </>
);

const Internal = () => {
  const isMobile = useIsMobile();
  const app = useApp();
  const synthCore = useSynthCore();
  const inputController = useInputController();
  const adsrEnvelope = useAdsrEnvelope();
  const oscillator1 = useOscillator1();
  const oscillator2 = useOscillator2();

  return (
    <MidiControllerProvider initial={{}} inputController={inputController}>
      <FilterProvider initial={{}} synthCore={synthCore}>
        <KeyboardControllerProvider initial={{}} app={app} inputController={inputController}>
          <SynthProvider
            initial={{}}
            inputController={inputController}
            adsrEnvelope={adsrEnvelope}
            oscillator={[oscillator1, oscillator2]}
            synthCore={synthCore}
          >
            <PresetsProvider initial={{}}>{isMobile ? <MobileLayout /> : <DesktopLayout />}</PresetsProvider>
          </SynthProvider>
        </KeyboardControllerProvider>
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

const HeaderInternal = () => {
  const [{ audioCtx, masterGain }] = useSynthCore();
  return (
    <Header>
      <HeaderEq audioCtx={audioCtx} master={masterGain} />
      <PresetPanel />
      <HeaderContainer>
        <Settings />
        <MasterHandle />
        <VolumeAnalyser audioCtx={audioCtx} master={masterGain} />
      </HeaderContainer>
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
