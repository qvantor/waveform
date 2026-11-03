import { styled } from 'styled-components';
import { keepFocus, theme } from '@waveform/ui-kit';

// a caret of the values of the synth (the tempo, the octave of the keys), a key of its own: of the color of their
// units, lit while hovered; a press takes no focus (the arrows and Space stay those of the page)
export const CaretButton = styled.button.attrs({ type: 'button', onMouseDown: keepFocus })`
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
  transition: color 150ms;

  &:hover {
    color: ${theme.colors.accent};
  }

  &:active {
    color: ${theme.colors.secondAccent};
  }

  &:focus,
  &:focus-visible {
    outline: none;
  }
`;
