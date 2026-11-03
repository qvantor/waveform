import React from 'react';
import { styled } from 'styled-components';
import { CaretDownOutlined, CaretUpOutlined } from '@ant-design/icons';
import { textBold12, theme } from '@waveform/ui-kit';
import { CaretButton } from './caret-button';

// a screen of the synth as the slot of the wheel and the tempo: its keys and the octave between them, as wide as its
// place, as high as it in a row (a flex row stretches it), else as its keys
const Plate = styled.div`
  flex: none;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 3px;
  background: ${theme.colors.primaryDark};
  box-shadow: inset 0 1px 3px rgb(0 0 0 / 70%);
`;

const Step = styled(CaretButton)`
  flex: 1 1 32px;
  min-height: 0;
  -webkit-tap-highlight-color: transparent;
  transition:
    color 150ms,
    background 150ms;

  &:hover {
    background: rgb(255 255 255 / 5%);
  }

  &:disabled {
    cursor: default;
    color: ${theme.colors.primaryDarkMediumContrast};
    background: none;
  }
`;

// the octave between the keys, as the values of the boxes beside the wheel
const Value = styled.div`
  ${textBold12};
  flex: none;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-block: 1px solid ${theme.colors.primaryDarkMediumContrast};
  color: ${theme.colors.white};
  font-variant-numeric: tabular-nums;
`;

// a press takes no focus: the keys stay those of the notes (Space or Enter would press a focused one)
const keepFocus = (e: React.MouseEvent) => e.preventDefault();

interface Props {
  octave: number;
  // ▲ and ▼ are disabled at its ends
  range: [number, number];
  onOctaveChange: (octave: number) => void;
  // what the octave is of: the title and the accessible name
  label?: string;
  className?: string;
}

// an octave of keys, ▲ and ▼ shift it
export const OctaveControl = ({ octave, range, onOctaveChange, label, className }: Props) => (
  <Plate role='group' title={label} aria-label={label} className={className}>
    <Step
      type='button'
      aria-label='Octave up'
      onMouseDown={keepFocus}
      onClick={() => onOctaveChange(octave + 1)}
      disabled={octave >= range[1]}
    >
      <CaretUpOutlined />
    </Step>
    <Value>C{octave}</Value>
    <Step
      type='button'
      aria-label='Octave down'
      onMouseDown={keepFocus}
      onClick={() => onOctaveChange(octave - 1)}
      disabled={octave <= range[0]}
    >
      <CaretDownOutlined />
    </Step>
  </Plate>
);
