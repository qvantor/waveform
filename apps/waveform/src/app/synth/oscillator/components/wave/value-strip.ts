import styled, { css } from 'styled-components';
import { DragValue, theme } from '@waveform/ui-kit';

const LINE = `1px solid ${theme.colors.primaryDarkMediumContrast}`;

// the line between a strip and the wave, the corners of the block on its side
const EDGES = {
  top: css`
    border-bottom: ${LINE};
    border-radius: 3px 3px 0 0;
  `,
  bottom: css`
    border-top: ${LINE};
    border-radius: 0 0 3px 3px;
  `,
};

// a strip of values of the block of the wave, on its background, over the wave (top) or under it (bottom): a line
// between it and the wave and between its values; as wide as the block, whatever its values (they never widen the
// oscillator)
export const Strip = styled.div<{ $edge: keyof typeof EDGES }>`
  display: flex;
  contain: inline-size;
  overflow: hidden;
  ${({ $edge }) => EDGES[$edge]}
`;

// each value as wide as the others, the whole cell is dragged
export const Cell = styled(DragValue)`
  flex: 1 1 0;
  justify-content: center;
  padding: 6px 7px;
  border-radius: 0;

  & + & {
    border-left: ${LINE};
  }

  .compact > & {
    padding: 6px 3px;
    gap: 3px;
    font-size: 10px;
  }
`;
