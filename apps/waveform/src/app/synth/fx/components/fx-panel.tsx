import React from 'react';
import styled from 'styled-components';
import { distinctUntilChanged, map } from 'rxjs';
import { FxType } from '@waveform/preset-schema';
import { useObservable } from '@waveform/rxjs-react';
import { Section, theme } from '@waveform/ui-kit';
import { useSynthCore } from '../../common/modules';
import { useFx } from '../modules';
import { FX_REGISTRY, MIX_PARAM } from '../effects';
import { ControlsGroup, FX_CONTROLS, ParamHandle } from './controls';
import { PresetSelect } from './preset-select';

const Controls = styled.div`
  display: flex;
  align-items: stretch;
  height: 100%;
`;

// the same for every effect, set apart on the right
const Out = styled(ControlsGroup)`
  margin-left: auto;
  padding-right: 0;
  border-left: 1px solid ${theme.colors.primaryLowContrast};
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
      <Controls>
        <EffectControls
          params={params}
          setParam={(key, value) => setParam(type, key, value)}
          on={on}
          sampleRate={audioCtx.sampleRate}
        />
        <Out caption='Out' disabled={!on}>
          <ParamHandle def={MIX_PARAM} value={mix} onChange={(value) => setMix(type, value)} disabled={!on} />
        </Out>
      </Controls>
    </Section>
  );
};
