import React from 'react';
import { styled } from 'styled-components';
import { CaretDownOutlined, CaretUpOutlined } from '@ant-design/icons';
import { theme } from '@waveform/ui-kit';

// px of the octave buttons
export const OCTAVE_WIDTH = 36;

// a screen of the synth as the slot of the wheel and the tempo: its keys and the octave between them, as high as
// its place in a row (a flex row stretches it), else as its keys
const Plate = styled.div`
  flex: none;
  width: ${OCTAVE_WIDTH}px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 3px;
  background: ${theme.colors.primaryDark};
  box-shadow: inset 0 1px 3px rgb(0 0 0 / 70%);
`;

// the carets of the values of the synth (the tempo, Oct, Unison): of the color of their units, lit while hovered
const Step = styled.button`
  flex: 1 1 32px;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: none;
  color: ${theme.colors.primaryDarkHighContrast};
  font-size: 14px;
  line-height: 0;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition:
    color 150ms,
    background 150ms;

  &:hover {
    color: ${theme.colors.accent};
    background: rgb(255 255 255 / 5%);
  }

  &:active {
    color: ${theme.colors.secondAccent};
  }

  &:disabled {
    cursor: default;
    color: ${theme.colors.primaryDarkMediumContrast};
    background: none;
  }

  &:focus {
    outline: none;
  }
`;

// the octave between the keys, as the values of the boxes beside the wheel
const Value = styled.div`
  flex: none;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-block: 1px solid ${theme.colors.primaryDarkMediumContrast};
  color: ${theme.colors.white};
  font-size: 12px;
  font-weight: 600;
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

// an octave of keys, ▲ and ▼ shift it. A render of the keys beside it (every note) renders none of it
export const OctaveControl = React.memo(({ octave, range, onOctaveChange, label, className }: Props) => (
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
));
