import React from 'react';
import styled from 'styled-components';
import { FxType } from '@waveform/preset-schema';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { Handle, Section } from '@waveform/ui-kit';
import { useFx } from '../modules';
import { FX_REGISTRY, MIX_PARAM } from '../effects';
import { FxParamDef } from '../effects/types';

const Controls = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: space-around;
  align-items: center;
  gap: 10px;
  height: 100%;
`;

interface ParamHandleProps {
  def: FxParamDef;
  value: number;
  onChange: (value: number) => void;
  disabled: boolean;
}

const ParamHandle = ({
  def: { label, min, max, mode, precision, formatValue },
  ...props
}: ParamHandleProps) => (
  <Handle
    label={label}
    min={min}
    max={max}
    mode={mode}
    precision={precision}
    formatValue={formatValue}
    {...props}
  />
);

// the knobs come from the effect definition, mix and the on/off switch are common for every effect
export const FxPanel = ({ type }: { type: FxType }) => {
  const [{ $effects }, { setOn, setMix, setParam }] = useFx();
  const { on, mix, params } = useBehaviorSubject($effects)[type];
  const { label, params: paramDefs } = FX_REGISTRY[type];
  return (
    <Section name={label} active={on} onClick={() => setOn(type, !on)}>
      <Controls>
        {Object.entries(paramDefs).map(([key, def]) => (
          <ParamHandle
            key={key}
            def={def}
            value={params[key]}
            onChange={(value) => setParam(type, key, value)}
            disabled={!on}
          />
        ))}
        <ParamHandle def={MIX_PARAM} value={mix} onChange={(value) => setMix(type, value)} disabled={!on} />
      </Controls>
    </Section>
  );
};
