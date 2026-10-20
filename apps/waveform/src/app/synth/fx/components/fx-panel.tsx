import React from 'react';
import styled from 'styled-components';
import { distinctUntilChanged, map } from 'rxjs';
import { FxType } from '@waveform/preset-schema';
import { useObservable } from '@waveform/rxjs-react';
import { Section } from '@waveform/ui-kit';
import { useSynthCore } from '../../common/modules';
import { useFx } from '../modules';
import { FX_REGISTRY, MIX_PARAM } from '../effects';
import { ControlsFlow, ControlsGroup, FX_CONTROLS, ParamHandle } from './controls';
import { PresetSelect } from './preset-select';

// cuts off what ControlsFlow puts out of the panel on the left; reaches the edges of the panel (its 10px
// padding) and the header (its 5px margin), so the shadows of the knobs aren't cut short
const Clip = styled.div`
  overflow: hidden;
  padding: 5px 10px 10px;
  margin: -5px -10px -10px;
`;

// the same for every effect, set apart on the right of its line
const Out = styled(ControlsGroup)`
  margin-left: auto;
`;

// presets in the header, the controls come from the effect, mix and the on/off switch are common for every effect
export const FxPanel = ({ type }: { type: FxType }) => {
  const [{ audioCtx }] = useSynthCore();
  const [{ $effects }, { setOn, setMix, setParam, applyPreset }] = useFx();
  // only this effect's state (update() keeps the other effects' objects), so a knob of one panel doesn't
  // re-render the others
  const $effect = React.useMemo(
    () =>
      $effects.pipe(
        map((effects) => effects[type]),
        distinctUntilChanged()
      ),
    [$effects, type]
  );
  const { on, mix, params } = useObservable($effect, $effects.value[type]);
  const EffectControls = FX_CONTROLS[type];
  return (
    <Section
      name={FX_REGISTRY[type].label}
      active={on}
      onClick={() => setOn(type, !on)}
      extra={<PresetSelect type={type} mix={mix} params={params} onSelect={(id) => applyPreset(type, id)} />}
    >
      <Clip>
        <ControlsFlow>
          <EffectControls
            params={params}
            setParam={(key, value) => setParam(type, key, value)}
            on={on}
            sampleRate={audioCtx.sampleRate}
            out={
              <Out caption='Out' disabled={!on}>
                <ParamHandle
                  def={MIX_PARAM}
                  value={mix}
                  onChange={(value) => setMix(type, value)}
                  disabled={!on}
                  target={`${type}.mix`}
                />
              </Out>
            }
          />
        </ControlsFlow>
      </Clip>
    </Section>
  );
};
