import React from 'react';
import { styled } from 'styled-components';
import { distinctUntilChanged, map } from 'rxjs';
import {
  PianoKeyboard,
  PITCH_WHEEL_WIDTH,
  VolumeAnalyser,
  FqAnalyser,
  QUIET_MS,
  TapeSwitch,
  theme,
  useElementSize,
  useIsMobile,
} from '@waveform/ui-kit';
import { useBehaviorSubject, useObservable } from '@waveform/rxjs-react';
import { DEFAULT_WAVETABLE_PATH } from '@waveform/preset-schema';
import { useApp } from '../app';
import { Header, HeaderSection, OctaveControl } from '../common/components';
import { PresetSection, PresetsProvider } from '../presets';
import { PerfHook } from '../perf/perf-hook';
import {
  SynthProvider,
  useSynth,
  InputControllerProvider,
  useInputController,
  EnvelopesProvider,
  useEnvelopes,
  LfoProvider,
  useLfos,
  ModulationProvider,
  useModulation,
  Oscillator1Provider,
  Oscillator2Provider,
  useOscillator1,
  useOscillator2,
  KeyboardControllerProvider,
  useKeyboardController,
  KEYBOARD_OCTAVES,
  SynthCoreProvider,
  useSynthCore,
  MidiControllerProvider,
  SoundSwitchProvider,
  useSoundSwitch,
  TransportProvider,
  useTransport,
} from './common/modules';
import { pianoOctaves } from './common/piano-octaves';
import { FilterProvider, FilterSection, useFilter } from './filter';
import { Oscillator1, Oscillator2, MasterHandle, LimiterStatus } from './synth/components';
import { VoicingSection } from './voicing';
import { MidiInput, SettingsButton } from './settings';
import { PitchBend } from './pitch-bend';
import { EnvelopeSection, VelocitySection } from './envelope';
import { LfoSection } from './lfo';
import { MobileLayout } from './mobile';
import { FxScreen, FxProvider, useFx } from './fx';
import { SYNTH_SCREENS, SynthScreen } from './screens';

// px of the keys: the row of the keys and the pitch bend
const KEY_HEIGHT = 100;
// px of a white key at most, and at least while octaves are taken off (up to 5 from the one under the octave of
// the computer keyboard)
const KEY_WIDTH = 40;
const MIN_KEY_WIDTH = 36;
const MAX_OCTAVES = 5;

// the row of the modulation (and the voicing) lower than the one of the sound: it stays under the fx too
const Root = styled.div`
  display: grid;
  grid-template-rows: 1.6fr 1fr ${KEY_HEIGHT}px;
  height: calc(100vh - 80px);
  gap: 1px;
  background: ${theme.colors.primaryLowContrast};
`;

// the oscillators and the filter after them, in the order the sound goes
const SynthRow = styled.div`
  display: grid;
  grid-template-columns: 3fr 3fr 2fr;
  background: ${theme.colors.primaryLowContrast};
  gap: 1px;
`;

// the columns of the row above: fr shares what the gaps leave, a fourth column would move its lines
const ModRow = styled.div`
  display: grid;
  grid-template-columns: 3fr 3fr 2fr;
  background: ${theme.colors.primaryLowContrast};
  gap: 1px;
`;

// the velocity and the voicing under the filter
const ModRight = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
`;

// the pitch bend left of the keys, as on a hardware keyboard: both as high as the row, a line between them as
// between the sections
const PianoContainer = styled.div`
  display: flex;
  gap: 1px;
  min-width: 0;
`;

// a section of its own, as the sections of the synth
const PitchSection = styled.div`
  display: flex;
  padding: 8px 12px 8px 8px;
  background: ${theme.colors.primary};
`;

// the octave of the computer keyboard right of the wheel, a section of its own: its plate as wide and as high as
// the slot of the wheel
const OctaveSection = styled(PitchSection)`
  padding: 8px;
`;

const KeyboardOctave = styled(OctaveControl)`
  width: ${PITCH_WHEEL_WIDTH}px;
`;

// the keys in the rest of the row, centered
const Keys = styled.div`
  flex: 1 1;
  min-width: 0;
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

const HeaderEq = styled(FqAnalyser)`
  flex: 1 1;
  height: 100%;
  margin-left: -20px; // stick to the logo, cancels Header gap
`;

// the keys: they alone render on every note
const DesktopKeys = ({ octaves, keyWidth }: { octaves: [number, number]; keyWidth: number }) => {
  const [{ $pressed }, { onPress, onRelease }] = useInputController();
  const pressed = useBehaviorSubject($pressed);
  return (
    <PianoKeyboard
      onPress={onPress}
      onRelease={onRelease}
      pressed={pressed}
      octaves={octaves}
      fitScreen={false}
      keyWidth={keyWidth}
      keyHeight={KEY_HEIGHT}
    />
  );
};

// the octaves that fit beside the wheel, their keys narrower rather than one octave fewer; they follow the octave
// of the computer keyboard, ▲ and ▼ (or ↓ and ↑) shift both
const PianoInternal = () => {
  const [{ $octave }, { setOctave }] = useKeyboardController();
  const octave = useBehaviorSubject($octave);
  const [keysRef, [width]] = useElementSize<HTMLDivElement>();
  const octaves = Math.min(MAX_OCTAVES, Math.max(1, Math.floor(width / (7 * MIN_KEY_WIDTH))));
  return (
    <PianoContainer>
      <PitchSection>
        <PitchBend />
      </PitchSection>
      <OctaveSection>
        <KeyboardOctave
          octave={octave}
          range={KEYBOARD_OCTAVES}
          onOctaveChange={setOctave}
          label={`Computer keyboard octave: Z = C${octave}, Q = C${octave + 1}`}
        />
      </OctaveSection>
      <Keys ref={keysRef}>
        {width > 0 && (
          <DesktopKeys
            octaves={pianoOctaves(octave, octaves)}
            keyWidth={Math.min(KEY_WIDTH, width / (7 * octaves))}
          />
        )}
      </Keys>
    </PianoContainer>
  );
};

const SynthRowInternal = () => (
  <SynthRow>
    <Oscillator1 />
    <Oscillator2 />
    <FilterSection />
  </SynthRow>
);

// the sources of the modulation and the voicing, on both screens
const ModRowInternal = () => (
  <ModRow>
    <EnvelopeSection />
    <LfoSection />
    <ModRight>
      <VelocitySection />
      <VoicingSection />
    </ModRight>
  </ModRow>
);

interface ScreenProps {
  screen: SynthScreen;
  onScreenChange: (screen: SynthScreen) => void;
}

const DesktopLayout = ({ screen, onScreenChange }: ScreenProps) => (
  <>
    <HeaderInternal screen={screen} onScreenChange={onScreenChange} />
    <Root>
      {/* the fx in the row of the oscillators, scrolled there */}
      {screen === 'osc' ? <SynthRowInternal /> : <FxScreen />}
      {/* the same element on both screens: the tabs, the charts and the dots of a note go on */}
      <ModRowInternal />
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

// the fx follow the envelopes and the LFOs of the last note of the synth
const FxInternal = ({ children }: React.PropsWithChildren) => {
  const synthCore = useSynthCore();
  const synth = useSynth();
  const lfo = useLfos();
  const modulation = useModulation();
  const transport = useTransport();
  return (
    <FxProvider
      initial={{}}
      synthCore={synthCore}
      transport={transport}
      synth={synth}
      lfo={lfo}
      modulation={modulation}
    >
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
  const transport = useTransport();
  const inputController = useInputController();
  const envelopes = useEnvelopes();
  const lfo = useLfos();
  const modulation = useModulation();
  const oscillator1 = useOscillator1();
  const oscillator2 = useOscillator2();
  const filter = useFilter();
  return (
    <SynthProvider
      initial={{}}
      transport={transport}
      inputController={inputController}
      envelopes={envelopes}
      lfo={lfo}
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
  const transport = useTransport();

  return (
    <MidiControllerProvider initial={{}} inputController={inputController} transport={transport}>
      <FilterProvider initial={{}} synthCore={synthCore}>
        <VoicesInternal>
          <KeyboardControllerProvider initial={{}} app={app} inputController={inputController}>
            <PresetsInternal>
              {/* nothing but in the perf build (scripts/bench-perf): above the layout switch, never remounted */}
              <PerfHook />
              {/* a failed master limiter, on every screen: above the layout switch too */}
              <LimiterStatus />
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

// a voice sounds: the meters of the output draw every frame; after the last one they sleep once its tails are over
const useSounding = () => {
  const [{ $voicesCount }] = useSynth();
  const $sounding = React.useMemo(
    () =>
      $voicesCount.pipe(
        map((count) => count > 0),
        distinctUntilChanged()
      ),
    [$voicesCount]
  );
  return useObservable($sounding, $voicesCount.value > 0);
};

// ms of silence the meters sleep after: past the longest gap between two echoes of the delay (in BPM up to 4 s)
const QUIET_MARGIN_MS = 500;
const useQuietMs = () => {
  const [{ $echoGap }] = useFx();
  const gap = useObservable($echoGap, 0);
  return Math.max(QUIET_MS, gap * 1000 + QUIET_MARGIN_MS);
};

// the meters render alone when the first voice starts and the last one ends, not the header
const OutputSpectrum = () => {
  const [{ audioCtx, output }] = useSynthCore();
  return <HeaderEq audioCtx={audioCtx} master={output} active={useSounding()} quietMs={useQuietMs()} />;
};

const OutputLevel = () => {
  const [{ audioCtx, output }] = useSynthCore();
  return <VolumeAnalyser audioCtx={audioCtx} master={output} active={useSounding()} quietMs={useQuietMs()} />;
};

const HeaderInternal = ({ screen, onScreenChange }: ScreenProps) => (
  <Header>
    <OutputSpectrum />
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
        <OutputLevel />
      </MasterSection>
    </HeaderRight>
  </Header>
);

// the LFOs run in the voices node of the synth core, in BPM at the tempo of the transport
const LfoInternal = ({ children }: React.PropsWithChildren) => {
  const synthCore = useSynthCore();
  const transport = useTransport();
  return (
    <LfoProvider initial={{}} synthCore={synthCore} transport={transport}>
      {children}
    </LfoProvider>
  );
};

// the envelopes in BPM at the tempo of the transport
const EnvelopesInternal = ({ children }: React.PropsWithChildren) => (
  <EnvelopesProvider initial={{}} transport={useTransport()}>
    {children}
  </EnvelopesProvider>
);

// the tempo and the transport on the clock of the synth core
const TransportInternal = ({ children }: React.PropsWithChildren) => {
  const synthCore = useSynthCore();
  return (
    <TransportProvider initial={{}} synthCore={synthCore}>
      {children}
    </TransportProvider>
  );
};

export default () => (
  <InputControllerProvider initial={{}}>
    <SynthCoreProvider initial={{}}>
      <TransportInternal>
        <EnvelopesInternal>
          <LfoInternal>
            <ModulationProvider initial={{}}>
              <OscillatorInternal>
                <Internal />
              </OscillatorInternal>
            </ModulationProvider>
          </LfoInternal>
        </EnvelopesInternal>
      </TransportInternal>
    </SynthCoreProvider>
  </InputControllerProvider>
);
