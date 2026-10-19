import React from 'react';
import styled from 'styled-components';
import { Handle, DraggableNumber } from '@waveform/ui-kit';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { number } from '@waveform/math';
import { OscillatorActions, OscillatorModel, useOscillator1 } from '../common/modules';
import { RxHandle } from '../../common/components';
import { useKnobModulation } from '../modulation/use-knob-modulation';
import { OscillatorContext, useOscillatorContext } from './hooks';
import { formatWavePosition, Wave, WaveSelector } from './components';

export { useOscillatorContext };

const Root = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 5px;
`;

const TopControls = styled.div`
  display: flex;
  gap: 5px;
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
  $waveTable,
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
  const wavetable = useBehaviorSubject($waveTable);
  const gainModulation = useKnobModulation(`${target}.gain`);
  const waveModulation = useKnobModulation(`${target}.wave`);
  const detuneModulation = useKnobModulation(`${target}.detune`);
  const onChangeInternal = (key: keyof typeof osc) => (value: number) =>
    setOscValue(key, Math.round(value * 100000) / 100000);

  return (
    <OscillatorContext.Provider value={oscillator}>
      <Root>
        <TopControls>
          <DraggableNumber
            value={osc.octave}
            label='Oct'
            range={ranges.octave}
            onChange={(value) => setOscValue('octave', value)}
          />
          <WaveSelector />
        </TopControls>
        <Wave />
        <Handles>
          <HandlesGroup>
            <RxHandle
              min={0}
              max={1}
              $value={$gain}
              label='Gain'
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
              max={Math.max(0, wavetable.length - 1)}
              $value={$position}
              label='Wave'
              onChange={setPosition}
              precision={1}
              formatValue={formatWavePosition}
              {...waveModulation}
            />
          </HandlesGroup>
          <HandlesGroup>
            <Handle
              plotSize={30}
              label='Unison'
              value={osc.unison}
              min={ranges.unison[0]}
              max={ranges.unison[1]}
              precision={1}
              onChange={onChangeInternal('unison')}
            />
            <Handle
              label='Detune'
              value={osc.detune}
              min={ranges.detune[0]}
              max={ranges.detune[1]}
              onChange={onChangeInternal('detune')}
              precision={1}
              {...detuneModulation}
            />
          </HandlesGroup>
        </Handles>
      </Root>
    </OscillatorContext.Provider>
  );
};
