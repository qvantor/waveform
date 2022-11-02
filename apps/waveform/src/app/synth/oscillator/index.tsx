import React from 'react';
import styled from 'styled-components';
import { Handle } from '@waveform/ui-kit';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { OscillatorActions, OscillatorModel, useOscillator1 } from '../common/modules';
import { OscillatorContext, useOscillatorContext } from './hooks';
import { Wave } from './components';
import { RxHandle } from '../../common/components';

export { useOscillatorContext };

const Root = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
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
  ranges,
  setOscValue,
  useOscillator,
  setCurrent,
}: Props) => {
  const oscillator = useOscillator();
  const osc = useBehaviorSubject($osc);
  const wavetable = useBehaviorSubject($waveTable);
  const onChangeInternal = (key: keyof typeof osc) => (value: number) =>
    setOscValue(key, Math.round(value * 100000) / 100000);

  return (
    <OscillatorContext.Provider value={oscillator}>
      <Root>
        <Wave />
        <Handles>
          <HandlesGroup>
            <RxHandle max={wavetable.length - 1} $value={$current} label='Wave' onChange={setCurrent} />
          </HandlesGroup>
          <HandlesGroup>
            <Handle
              label='Unison'
              value={osc.unison}
              min={ranges.unison[0]}
              max={ranges.unison[1]}
              rotateSpeed={10}
              onChange={onChangeInternal('unison')}
            />
            <Handle
              label='Detune'
              value={osc.detune}
              min={ranges.detune[0]}
              max={ranges.detune[1]}
              onChange={onChangeInternal('detune')}
            />
            <Handle
              label='Phase rand'
              value={osc.randPhase}
              min={ranges.randPhase[0]}
              max={ranges.randPhase[1]}
              step={0.00001}
              onChange={onChangeInternal('randPhase')}
            />
          </HandlesGroup>
        </Handles>
      </Root>
    </OscillatorContext.Provider>
  );
};
