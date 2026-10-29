import React from 'react';
import styled from 'styled-components';
import cls from 'classnames';
import { Handle, DraggableNumber } from '@waveform/ui-kit';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { number } from '@waveform/math';
import { OscillatorActions, OscillatorModel, useOscillator1 } from '../common/modules';
import { RxHandle } from '../../common/components';
import { useKnobModulation } from '../modulation/use-knob-modulation';
import { OscillatorContext, useCompact, useOscillatorContext } from './hooks';
import { formatWavePosition, Wave, WaveSelector } from './components';

export { useOscillatorContext };

const Root = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 5px;
`;

// Oct, Semi, Fine and the table: as wide as the oscillator whatever they hold (the name of the table is cut)
const TopControls = styled.div`
  display: flex;
  gap: 5px;
  contain: inline-size;

  & > :not(:last-child) {
    flex: none;
  }

  & > :last-child {
    min-width: 0;
  }

  &.compact {
    gap: 3px;
  }
`;

const Handles = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
`;

const HandlesGroup = styled.div`
  display: flex;
  gap: 10px;
`;

type Props = OscillatorModel &
  OscillatorActions & {
    useOscillator: typeof useOscillator1;
    // the prefix of its modulation targets (osc1.gain…)
    target?: 'osc1' | 'osc2';
  };

export const Oscillator = ({
  $osc,
  $position,
  $frames,
  $gain,
  ranges,
  setOscValue,
  useOscillator,
  setPosition,
  setGain,
  target = 'osc1',
}: Props) => {
  // const wavetables = useWavetables();

  const oscillator = useOscillator();
  const osc = useBehaviorSubject($osc);
  // the frames played (of an expanded table 256)
  const frames = useBehaviorSubject($frames);
  const gainModulation = useKnobModulation(`${target}.gain`);
  const waveModulation = useKnobModulation(`${target}.wave`);
  const detuneModulation = useKnobModulation(`${target}.detune`);
  // Pitch on Semi (smoothly, ±48 semitones), Fine in cents
  const pitchModulation = useKnobModulation(`${target}.pitch`);
  const fineModulation = useKnobModulation(`${target}.fine`);
  // narrow: the fields smaller, without their carets
  const [topRef, compact] = useCompact<HTMLDivElement>();

  return (
    <OscillatorContext.Provider value={oscillator}>
      <Root>
        <TopControls ref={topRef} className={cls({ compact })}>
          <DraggableNumber
            value={osc.octave}
            label='Oct'
            range={ranges.octave}
            compact={compact}
            onChange={(value) => setOscValue('octave', value)}
          />
          <DraggableNumber
            value={osc.semi}
            label='Semi'
            range={ranges.semi}
            compact={compact}
            onChange={(value) => setOscValue('semi', value)}
            {...pitchModulation}
          />
          <DraggableNumber
            value={osc.fine}
            label='Fine'
            range={ranges.fine}
            pxPerStep={2}
            compact={compact}
            onChange={(value) => setOscValue('fine', value)}
            {...fineModulation}
          />
          <WaveSelector />
        </TopControls>
        <Wave modulations={waveModulation.modulations} />
        <Handles>
          <HandlesGroup>
            <RxHandle
              min={0}
              max={1}
              $value={$gain}
              label='Gain'
              name='Volume'
              onChange={setGain}
              formatValue={(value) => number.percent(number.round(value, 100))}
              precision={100}
              {...gainModulation}
            />
          </HandlesGroup>
          <HandlesGroup>
            {/* steps by whole frames, the label is the frame from 1 */}
            <RxHandle
              min={0}
              max={Math.max(0, frames - 1)}
              $value={$position}
              label='Wave'
              name='Wave position'
              onChange={setPosition}
              precision={1}
              formatValue={formatWavePosition}
              {...waveModulation}
            />
          </HandlesGroup>
          <HandlesGroup>
            <Handle
              label='Detune'
              name='Unison detune'
              value={osc.detune}
              min={ranges.detune[0]}
              max={ranges.detune[1]}
              onChange={(value) => setOscValue('detune', Math.round(value * 100000) / 100000)}
              precision={1}
              {...detuneModulation}
            />
          </HandlesGroup>
        </Handles>
      </Root>
    </OscillatorContext.Provider>
  );
};
