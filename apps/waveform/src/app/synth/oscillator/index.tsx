import React from 'react';
import { distinctUntilChanged, map } from 'rxjs';
import styled from 'styled-components';
import { Handle } from '@waveform/ui-kit';
import { useBehaviorSubject, useObservable } from '@waveform/rxjs-react';
import { number } from '@waveform/math';
import { OSC_DEFAULTS } from '@waveform/preset-schema';
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
  // only the unison detune: Oct, Semi, Fine, the phases and the unison render their strips (a drag of one
  // doesn't render the oscillator)
  const $detune = React.useMemo(
    () =>
      $osc.pipe(
        map(({ detune }) => detune),
        distinctUntilChanged()
      ),
    [$osc]
  );
  const detune = useObservable($detune, $osc.value.detune);
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
              defaultValue={OSC_DEFAULTS.g}
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
              defaultValue={OSC_DEFAULTS.w}
              {...waveModulation}
            />
          </HandlesGroup>
          <HandlesGroup>
            <Handle
              label='Detune'
              name='Unison detune'
              value={detune}
              min={ranges.detune[0]}
              max={ranges.detune[1]}
              onChange={(value) => setOscValue('detune', Math.round(value * 100000) / 100000)}
              precision={1}
              defaultValue={OSC_DEFAULTS.d}
              {...detuneModulation}
            />
          </HandlesGroup>
        </Handles>
      </Root>
    </OscillatorContext.Provider>
  );
};
