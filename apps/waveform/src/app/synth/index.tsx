import React from 'react';
import styled from 'styled-components';
import { PianoKeyboard, AdsrEnvelope, Section, VolumeAnalyser, FqAnalyser, theme } from '@waveform/ui-kit';
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
import { FilterProvider, FilterSection } from './filter';
import { useApp } from '../app';
import { Header } from '../common/components';
import { RxHandle } from '../common/components';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { OscillatorsContainer } from './synth/components';
import { number } from '@waveform/math';
import { VoicingSection } from './voicing';

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
      <FilterSection />
      <VoicingSection />
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
    <FilterProvider initial={{}} synthCore={synthCore}>
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
    </FilterProvider>
  );
};

const OscillatorInternal = ({ children }: React.PropsWithChildren) => {
  const [wt, setWT] = React.useState<number[][] | null>(null);
  const synthCore = useSynthCore();
  React.useEffect(() => {
    const load = async () => {
      const data = await fetch('/assets/wavetables/basic-shapes.json');
      const result = (await data.json()) as number[][];
      setWT(result);
    };
    load();
  }, []);
  if (wt === null) return null;
  return (
    <Oscillator1Provider initial={{ waveTable: wt, active: true, current: 1 }} synthCore={synthCore}>
      <Oscillator2Provider initial={{ waveTable: wt, active: false, current: 0 }} synthCore={synthCore}>
        {children}
      </Oscillator2Provider>
    </Oscillator1Provider>
  );
};

const HeaderInternal = () => {
  const [{ audioCtx, masterGain, $masterGain }, { setMasterGain }] = useSynthCore();
  return (
    <Header>
      <HeaderEq audioCtx={audioCtx} master={masterGain} />
      <HeaderContainer>
        <RxHandle
          min={0}
          max={1.3}
          $value={$masterGain}
          onChange={setMasterGain}
          label='Master'
          formatValue={(value) => number.percent(number.round(value, 100))}
          precision={100}
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
