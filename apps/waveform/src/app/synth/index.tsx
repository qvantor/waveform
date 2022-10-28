import React from 'react';
import { PianoKeyboard } from '@waveform/ui-kit';
import { SynthProvider, InputControllerProvider, useInputController } from './common/modules';
import { useApp } from '../app';
import { useBehaviorSubject } from '@waveform/rxjs-react';

const PianoInternal = () => {
  const [{ $pressed }, { onPress, onRelease }] = useInputController();
  const pressed = useBehaviorSubject($pressed);
  return <PianoKeyboard onPress={onPress} onRelease={onRelease} pressed={pressed} />;
};

const Internal = () => {
  const inputController = useInputController();
  return (
    <SynthProvider initial={{}} inputController={inputController}>
      <div />
      <PianoInternal />
    </SynthProvider>
  );
};

export default () => {
  const app = useApp();
  return (
    <InputControllerProvider initial={{}} app={app}>
      <Internal />
    </InputControllerProvider>
  );
};
