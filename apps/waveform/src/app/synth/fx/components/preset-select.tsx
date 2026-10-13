import React from 'react';
import cls from 'classnames';
import styled from 'styled-components';
import { AiOutlineLeft, AiOutlineRight } from 'react-icons/ai';
import { FxType } from '@waveform/preset-schema';
import { theme } from '@waveform/ui-kit';
import { FX_REGISTRY, findFxPreset } from '../effects';

// a compact ◀ name ▶ picker
const Root = styled.div`
  flex: 0 1 36%;
  min-width: 200px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px;
`;

const Arrow = styled.button`
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: ${theme.borderRadius.m};
  background: transparent;
  color: ${theme.colors.white};
  cursor: pointer;
  transition: background 150ms;

  &:hover {
    background: rgba(255, 255, 255, 0.25);
  }
`;

const Name = styled.select`
  flex: 1;
  min-width: 0;
  height: 20px;
  padding: 0 8px;
  border: 1px solid ${theme.colors.primaryLowContrast};
  border-radius: ${theme.borderRadius.m};
  background: ${theme.colors.white};
  color: ${theme.colors.primaryDark};
  font-size: 12px;
  font-weight: 600;
  text-align: center;
  text-align-last: center;
  appearance: none;
  cursor: pointer;
  transition: border-color 150ms;

  &:hover,
  &:focus {
    outline: none;
    border-color: ${theme.colors.secondAccent};
  }

  // edited away from every preset, like the dirty mark of the synth preset
  &.custom {
    color: ${theme.colors.secondAccent};
  }
`;

const CUSTOM = '';

// the preset select must not keep the focus, otherwise QWERTY notes are swallowed by it
const preventFocus = (e: React.MouseEvent) => e.preventDefault();

interface Props {
  type: FxType;
  mix: number;
  params: Record<string, number>;
  onSelect: (id: string) => void;
}

// the built-in presets of the effect, "Custom" is shown only while the sound matches none of them
export const PresetSelect = ({ type, mix, params, onSelect }: Props) => {
  const presets = FX_REGISTRY[type].presets;
  const value = findFxPreset(type, { mix, params })?.id ?? CUSTOM;
  // from Custom: ◀ goes to the last preset, ▶ to the first one
  const index = presets.findIndex(({ id }) => id === value);
  const step = (delta: number) => {
    const from = index === -1 ? (delta > 0 ? -1 : 0) : index;
    onSelect(presets[(from + delta + presets.length) % presets.length].id);
  };
  return (
    <Root role='group' aria-label='Preset'>
      <Arrow tabIndex={-1} onMouseDown={preventFocus} onClick={() => step(-1)} aria-label='Previous preset'>
        <AiOutlineLeft />
      </Arrow>
      <Name
        className={cls({ custom: value === CUSTOM })}
        value={value}
        tabIndex={-1}
        onChange={(e) => {
          e.target.blur();
          if (e.target.value !== CUSTOM) onSelect(e.target.value);
        }}
      >
        {value === CUSTOM && <option value={CUSTOM}>Custom</option>}
        {presets.map(({ id, name }) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </Name>
      <Arrow tabIndex={-1} onMouseDown={preventFocus} onClick={() => step(1)} aria-label='Next preset'>
        <AiOutlineRight />
      </Arrow>
    </Root>
  );
};
