import React from 'react';
import styled from 'styled-components';
import { PianoKeyboard, AdsrEnvelope } from '@waveform/ui-kit';
import {
  SynthProvider,
  InputControllerProvider,
  useInputController,
  AdsrEnvelopeProvider,
  useAdsrEnvelope,
  OscillatorProvider,
  useOscillator,
} from './common/modules';
import { useApp } from '../app';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { Oscillator } from './oscillator';

const Root = styled.div`
  display: grid;
  grid-template-rows: 1fr 1fr 100px;
  height: calc(100vh - 80px);
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
  const inputController = useInputController();
  const adsrEnvelope = useAdsrEnvelope();
  const oscillator = useOscillator();
  return (
    <SynthProvider
      initial={{}}
      inputController={inputController}
      adsrEnvelope={adsrEnvelope}
      oscillator={oscillator}
    >
      <Root>
        <div style={{ width: '40%' }}>
          <Oscillator {...oscillator[0]} {...oscillator[1]} />
        </div>
        <AdsrEnvelopeInternal />
        <PianoInternal />
      </Root>
    </SynthProvider>
  );
};

export default () => {
  const app = useApp();
  return (
    <InputControllerProvider initial={{}} app={app}>
      <AdsrEnvelopeProvider initial={{}}>
        <OscillatorProvider initial={{}}>
          <Internal />
        </OscillatorProvider>
      </AdsrEnvelopeProvider>
    </InputControllerProvider>
  );
};
