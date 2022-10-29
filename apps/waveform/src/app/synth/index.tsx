import React from 'react';
import { PianoKeyboard, AdsrEnvelope } from '@waveform/ui-kit';
import {
  SynthProvider,
  InputControllerProvider,
  useInputController,
  AdsrEnvelopeProvider,
  useAdsrEnvelope,
} from './common/modules';
import { useApp } from '../app';
import { useBehaviorSubject } from '@waveform/rxjs-react';

const PianoInternal = () => {
  const [{ $pressed }, { onPress, onRelease }] = useInputController();
  const pressed = useBehaviorSubject($pressed);
  return <PianoKeyboard onPress={onPress} onRelease={onRelease} pressed={pressed} />;
};

const AdsrEnvelopeInternal = () => {
  const [{ $envelope }, { setEnvelopeValue }] = useAdsrEnvelope();
  const envelope = useBehaviorSubject($envelope);
  return (
    <div style={{ width: '50%', padding: 20 }}>
      <AdsrEnvelope {...envelope} onChange={setEnvelopeValue} />
    </div>
  );
};

const Internal = () => {
  const inputController = useInputController();
  const adsrEnvelope = useAdsrEnvelope();
  return (
    <SynthProvider initial={{}} inputController={inputController} adsrEnvelope={adsrEnvelope}>
      <div />
      <AdsrEnvelopeInternal />
      <PianoInternal />
    </SynthProvider>
  );
};

export default () => {
  const app = useApp();
  return (
    <InputControllerProvider initial={{}} app={app}>
      <AdsrEnvelopeProvider initial={{}}>
        <Internal />
      </AdsrEnvelopeProvider>
    </InputControllerProvider>
  );
};
