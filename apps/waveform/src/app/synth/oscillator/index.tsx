import React from 'react';
import styled from 'styled-components';
import { theme, Handle } from '@waveform/ui-kit';
import { OscillatorActions, OscillatorModel } from '../common/modules';
import { useBehaviorSubject } from '@waveform/rxjs-react';

const Root = styled.div`
  height: 100%;
  display: grid;
  grid-template-rows: 1fr 1fr;
`;

const Wave = styled.div`
  background: ${theme.colors.primaryDark};
  margin: 0 10px;
`;

const Handles = styled.div`
  margin: 0 10px;
  display: flex;
  flex-direction: row;
  justify-content: space-between;
`;

const HandlesGroup = styled.div`
  display: flex;
  gap: 10px;
`;

type Props = OscillatorModel & OscillatorActions;

export const Oscillator = ({ $osc, ranges, setOscValue }: Props) => {
  const osc = useBehaviorSubject($osc);
  const onChangeInternal = (key: keyof typeof osc) => (value: number) =>
    setOscValue(key, Math.round(value * 10000) / 10000);

  return (
    <Root>
      <Wave />
      <Handles>
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
        </HandlesGroup>
        <HandlesGroup>
          <Handle
            label='Phase rand'
            value={osc.randPhase}
            min={ranges.randPhase[0]}
            max={ranges.randPhase[1]}
            step={0.0001}
            onChange={onChangeInternal('randPhase')}
          />
        </HandlesGroup>
      </Handles>
    </Root>
  );
};
