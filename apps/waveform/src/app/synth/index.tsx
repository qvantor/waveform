import React from 'react';
import styled from 'styled-components';
import { PianoKeyboard, AdsrEnvelope, Section, VolumeAnalyser, theme } from '@waveform/ui-kit';
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
} from './common/modules';
import { useApp } from '../app';
import { Header } from '../common/components';
import { RxHandle } from '../common/components';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { OscillatorsContainer } from './synth/components';
import { number } from '@waveform/math';

const Root = styled.div`
  display: grid;
  grid-template-rows: 1fr 1fr 110px;
  height: calc(100vh - 80px);
  gap: 1px;
  background: ${theme.colors.primaryLowContrast};
`;

const AdsrContainer = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
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
  const [{ $envelope }, { setEnvelopeValue }] = useAdsrEnvelope();
  const envelope = useBehaviorSubject($envelope);
  return (
    <AdsrContainer>
      <Section name='Envelope'>
        <AdsrEnvelope {...envelope} onChange={setEnvelopeValue} />
      </Section>
      <Section name='Filters'>filters will be in here</Section>
    </AdsrContainer>
  );
};

const Internal = () => {
  const app = useApp();
  const synthCore = useSynthCore();
  const inputController = useInputController();
  const adsrEnvelope = useAdsrEnvelope();
  const oscillator1 = useOscillator1();
  const oscillator2 = useOscillator2();

  return (
    <KeyboardControllerProvider initial={{}} app={app} inputController={inputController}>
      <SynthProvider
        initial={{}}
        inputController={inputController}
        adsrEnvelope={adsrEnvelope}
        oscillator={[oscillator1, oscillator2]}
        synthCore={synthCore}
      >
        <Root>
          <OscillatorsContainer />
          <AdsrEnvelopeInternal />
          <PianoInternal />
        </Root>
      </SynthProvider>
    </KeyboardControllerProvider>
  );
};

const OscillatorInternal = ({ children }: React.PropsWithChildren) => {
  const synthCore = useSynthCore();
  return (
    <Oscillator1Provider initial={{}} synthCore={synthCore}>
      <Oscillator2Provider initial={{}} synthCore={synthCore}>
        {children}
      </Oscillator2Provider>
    </Oscillator1Provider>
  );
};

const HeaderInternal = () => {
  const [{ audioCtx, masterGain, $masterGain }, { setMasterGain }] = useSynthCore();
  return (
    <Header>
      <HeaderContainer>
        <RxHandle
          min={0}
          max={1.3}
          step={0.01}
          $value={$masterGain}
          onChange={setMasterGain}
          label='Master'
          formatValue={number.round}
        />
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
          <HeaderInternal />
          <Internal />
        </OscillatorInternal>
      </AdsrEnvelopeProvider>
    </SynthCoreProvider>
  </InputControllerProvider>
);
