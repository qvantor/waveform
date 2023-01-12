import React from 'react';
import styled from 'styled-components';
import { Handle, DraggableNumber } from '@waveform/ui-kit';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { number } from '@waveform/math';
import { OscillatorActions, OscillatorModel, useOscillator1 } from '../common/modules';
import { RxHandle } from '../../common/components';
import { OscillatorContext, useOscillatorContext } from './hooks';
import { Wave, WaveSelector } from './components';

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

type Props = OscillatorModel & OscillatorActions & { useOscillator: typeof useOscillator1 };

export const Oscillator = ({
  $osc,
  $current,
  $waveTable,
  $gain,
  ranges,
  setOscValue,
  useOscillator,
  setCurrent,
  setGain,
}: Props) => {
  // const wavetables = useWavetables();

  const oscillator = useOscillator();
  const osc = useBehaviorSubject($osc);
  const wavetable = useBehaviorSubject($waveTable);
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
            />
          </HandlesGroup>
          <HandlesGroup>
            <RxHandle
              max={wavetable.length - 1}
              $value={$current}
              label='Wave'
              onChange={setCurrent}
              precision={1}
              formatValue={(value) => `${value + 1}`}
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
            />
            <Handle
              label='Phase rand'
              value={osc.randPhase}
              min={ranges.randPhase[0]}
              max={ranges.randPhase[1]}
              precision={100000}
              onChange={onChangeInternal('randPhase')}
            />
          </HandlesGroup>
        </Handles>
      </Root>
    </OscillatorContext.Provider>
  );
};
