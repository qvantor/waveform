import React from 'react';
import styled from 'styled-components';
import { PianoKeyboard, AdsrEnvelope } from '@waveform/ui-kit';
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
} from './common/modules';
import { useApp } from '../app';
import { Header } from '../common/components';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { Oscillator } from './oscillator';

const Root = styled.div`
  display: grid;
  grid-template-rows: 1fr 1fr 100px;
  height: calc(100vh - 80px);
`;

const OscillatorContainer = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
`;

const PianoInternal = () => {
  const [{ $pressed }, { onPress, onRelease }] = useInputController();
  const pressed = useBehaviorSubject($pressed);
  return <PianoKeyboard onPress={onPress} onRelease={onRelease} pressed={pressed} />;
};

const AdsrEnvelopeInternal = () => {
  const [{ $envelope }, { setEnvelopeValue }] = useAdsrEnvelope();
  const envelope = useBehaviorSubject($envelope);
  return (
    <div style={{ width: '50%' }}>
      <AdsrEnvelope {...envelope} onChange={setEnvelopeValue} />
    </div>
  );
};

const Internal = () => {
  const app = useApp();
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
      >
        <Root>
          <OscillatorContainer>
            <Oscillator {...oscillator1[0]} {...oscillator1[1]} useOscillator={useOscillator1} />
            <Oscillator {...oscillator2[0]} {...oscillator2[1]} useOscillator={useOscillator2} />
          </OscillatorContainer>
          <AdsrEnvelopeInternal />
          <PianoInternal />
        </Root>
      </SynthProvider>
    </KeyboardControllerProvider>
  );
};

export default () => (
  <InputControllerProvider initial={{}}>
    <AdsrEnvelopeProvider initial={{}}>
      <Oscillator1Provider initial={{}}>
        <Oscillator2Provider initial={{}}>
          <Header />
          <Internal />
        </Oscillator2Provider>
      </Oscillator1Provider>
    </AdsrEnvelopeProvider>
  </InputControllerProvider>
);
