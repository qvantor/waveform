import React from 'react';
import styled from 'styled-components';
import { Handle } from '@waveform/ui-kit';
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

// the table: as wide as the oscillator whatever its name (cut with an ellipsis)
const Table = styled.div`
  contain: inline-size;
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
  const oscillator = useOscillator();
  const osc = useBehaviorSubject($osc);
  // the frames played (of an expanded table 256)
  const frames = useBehaviorSubject($frames);
  const gainModulation = useKnobModulation(`${target}.gain`);
  const waveModulation = useKnobModulation(`${target}.wave`);
  const detuneModulation = useKnobModulation(`${target}.detune`);

  return (
    <OscillatorContext.Provider value={oscillator}>
      <Root>
        <Table>
          <WaveSelector />
        </Table>
        <Wave modulations={waveModulation.modulations} target={target} />
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
