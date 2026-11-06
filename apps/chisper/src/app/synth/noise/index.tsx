import { styled } from 'styled-components';
import {
  Handle,
  HandleProps,
  LoopIcon,
  OneShotIcon,
  Section,
  SwitchKey,
  SwitchKeys,
  theme,
  TrackIcon,
} from '@chisper/ui-kit';
import { useBehaviorSubject } from '@chisper/rxjs-react';
import { number } from '@chisper/math';
import { NOISE_DEFAULTS } from '@chisper/preset-schema';
import { NoiseModel, useNoise } from '../common/modules';
import type { NoiseNumeric } from '../common/modules/noise';
import { useKnobModulation } from '../modulation/use-knob-modulation';
import { Cell, Strip } from '../oscillator/components/wave/value-strip';
import { NoiseOverview } from './components/noise-overview';
import { NoiseSelector } from './components/noise-selector';
import { NoiseStatus } from './components/noise-status';
import { useNoiseField } from './hooks/use-noise-field';

const Root = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
  container-type: inline-size;
`;

// the sample: as wide as the section whatever its name (cut in its middle)
const Selector = styled.div`
  contain: inline-size;
`;

// the keys of the playback over the overview, Start and Rand under it: one dark block, as the wave of an oscillator
// with Oct, Semi and Fine over it (its status over it all: the overview may have no height)
const Block = styled.div`
  flex: 1 1;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  background: ${theme.colors.primaryDark};
  border-radius: 3px;
`;

// the keys on the strip over the overview, every one as wide; as high as a strip of values (a line of 14 px and
// 6 px over and under it)
const KeyStrip = styled(Strip)`
  flex: none;
  height: 26px;
`;

// two by two in its column, in a row where the section is as wide (a phone: the overview keeps its height)
const Knobs = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  justify-items: center;
  row-gap: 4px;

  @container (min-width: 260px) {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
`;

const signed = (value: number) => (value > 0 ? `+${value}` : `${value}`);
// the pan as the renders show it: 0 in the centre, 50 at either side
export const formatPan = (pan: number) => {
  const side = Math.round(Math.abs(pan) * 50);
  return side === 0 ? 'C' : `${side} ${pan < 0 ? 'L' : 'R'}`;
};

// a knob of a value of $noise: it renders itself on a change, not the section
const NoiseKnob = ({
  $noise,
  field,
  ...props
}: Omit<HandleProps, 'value'> & { $noise: NoiseModel['$noise']; field: NoiseNumeric }) => (
  <Handle {...props} value={useNoiseField($noise, field)} />
);

// Loop or One-shot and Pitch Track: they render on their own values
const PlaybackKeys = () => {
  const [{ $noise }, { setLoop, setKeytrack }] = useNoise();
  const loop = useNoiseField($noise, 'loop');
  const keytrack = useNoiseField($noise, 'keytrack');
  return (
    <KeyStrip $edge='top'>
      <SwitchKeys fill aria-label='Playback'>
        <SwitchKey
          on={loop}
          onChange={() => setLoop(true)}
          name='Loop'
          hint='The sample plays around and around while the note sounds'
          icon={<LoopIcon />}
        />
        <SwitchKey
          on={!loop}
          onChange={() => setLoop(false)}
          name='One-shot'
          hint='The sample plays once and stops at its end (attacks, clicks)'
          icon={<OneShotIcon />}
        />
      </SwitchKeys>
      <SwitchKeys fill aria-label='Pitch'>
        <SwitchKey
          on={keytrack}
          onChange={setKeytrack}
          name='Pitch Track'
          hint='The pitch follows the keys and the bend: C5 plays the sample at its own pitch'
          icon={<TrackIcon />}
        />
      </SwitchKeys>
    </KeyStrip>
  );
};

// Start and Rand under the overview: they render on their own values
const StartCells = () => {
  const [{ $noise, ranges }, { setNoiseValue }] = useNoise();
  const start = useNoiseField($noise, 'start');
  const rand = useNoiseField($noise, 'rand');
  return (
    <Strip $edge='bottom' className='compact'>
      <Cell
        label='Start'
        value={start}
        min={ranges.start[0]}
        max={ranges.start[1]}
        precision={100}
        formatValue={number.percent}
        defaultValue={NOISE_DEFAULTS.st}
        onChange={(value) => setNoiseValue('start', value)}
      />
      <Cell
        label='Rand'
        value={rand}
        min={ranges.rand[0]}
        max={ranges.rand[1]}
        precision={100}
        formatValue={number.percent}
        defaultValue={NOISE_DEFAULTS.rd}
        onChange={(value) => setNoiseValue('rand', value)}
      />
    </Strip>
  );
};

// the noise oscillator (between the oscillators and the filter): its sample by category, an overview of it with where
// notes start, Loop or One-shot and Pitch Track over it, Start and Rand under it, the knobs Pitch, Fine, Pan and Gain
// (route targets). A value of $noise renders only what shows it
export const NoiseSection = () => {
  const [{ $active, $noise, ranges }, { toggleActive, setNoiseValue }] = useNoise();
  const active = useBehaviorSubject($active);
  const modulation = {
    pitch: useKnobModulation('noise.pitch'),
    fine: useKnobModulation('noise.fine'),
    pan: useKnobModulation('noise.pan'),
    level: useKnobModulation('noise.level'),
  };
  return (
    <Section name='Noise' active={active} onClick={toggleActive}>
      <Root>
        <Selector>
          <NoiseSelector />
        </Selector>
        <Block>
          <NoiseStatus />
          <PlaybackKeys />
          <NoiseOverview />
          <StartCells />
        </Block>
        <Knobs>
          <NoiseKnob
            $noise={$noise}
            field='pitch'
            label='Pitch'
            name='Noise pitch'
            min={ranges.pitch[0]}
            max={ranges.pitch[1]}
            precision={1}
            formatValue={(value) => `${signed(value)} st`}
            defaultValue={NOISE_DEFAULTS.s}
            fillFrom={0}
            onChange={(value) => setNoiseValue('pitch', value)}
            {...modulation.pitch}
          />
          <NoiseKnob
            $noise={$noise}
            field='fine'
            label='Fine'
            name='Noise fine'
            min={ranges.fine[0]}
            max={ranges.fine[1]}
            precision={1}
            formatValue={(value) => `${signed(value)} ct`}
            defaultValue={NOISE_DEFAULTS.f}
            fillFrom={0}
            onChange={(value) => setNoiseValue('fine', value)}
            {...modulation.fine}
          />
          <NoiseKnob
            $noise={$noise}
            field='pan'
            label='Pan'
            name='Noise pan'
            min={ranges.pan[0]}
            max={ranges.pan[1]}
            precision={100}
            formatValue={formatPan}
            defaultValue={NOISE_DEFAULTS.pn}
            fillFrom={0}
            onChange={(value) => setNoiseValue('pan', value)}
            {...modulation.pan}
          />
          <NoiseKnob
            $noise={$noise}
            field='level'
            label='Gain'
            name='Noise volume'
            min={ranges.level[0]}
            max={ranges.level[1]}
            precision={100}
            formatValue={(value) => number.percent(number.round(value, 100))}
            defaultValue={NOISE_DEFAULTS.g}
            onChange={(value) => setNoiseValue('level', value)}
            {...modulation.level}
          />
        </Knobs>
      </Root>
    </Section>
  );
};
