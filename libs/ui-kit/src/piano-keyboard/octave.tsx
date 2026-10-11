import React from 'react';
import styled from 'styled-components';
import cls from 'classnames';
import { theme } from '../common/constants';
import { Notes } from '../common/types';

const Root = styled.div`
  display: flex;
`;

// key sizes are css variables set on the root: size props would generate a new class for every value
const KeyWhite = styled.div`
  width: var(--key-width);
  height: var(--key-height);
  flex: 0 0 auto;
  border-radius: 0 0 12px 12px;
  background: ${theme.colors.white};
  box-shadow: inset 0px -2px 3px 1px rgb(127 140 141 / 20%);

  &.pressed {
    background: linear-gradient(180deg, rgba(255, 255, 255, 1) 0%, rgba(236, 240, 241, 1) 100%);
    box-shadow: inset 0px -2px 6px 2px rgb(127 140 141 / 20%);
  }
`;

const KeyWhiteOffset = styled(KeyWhite)`
  margin-left: calc(var(--key-width) / -4);
`;

const KeyBlack = styled.div`
  box-shadow: -1px -1px 2px rgb(255 255 255 / 20%) inset, 0 -5px 2px 3px rgb(0 0 0 / 60%) inset;
  background: linear-gradient(45deg, #222 0%, #555 100%);
  border-radius: 0 0 6px 6px;

  height: calc(var(--key-height) / 2);
  width: calc(var(--key-width) / 2);
  flex: 0 0 auto;
  margin-left: calc(var(--key-width) / -4);
  z-index: 1;

  &.pressed {
    box-shadow: -1px -1px 2px rgb(255 255 255 / 20%) inset, 0 -2px 2px 3px rgb(0 0 0 / 60%) inset,
      0 1px 2px rgb(0 0 0 / 50%);
    background: linear-gradient(to right, #444 0%, #222 100%);
  }
`;

interface Props {
  octave: number;
  pressed: Notes[];
  keyWidth: number;
  keyHeight: number;
}

export const Octave = React.memo(({ octave, pressed, keyWidth, keyHeight }: Props) => {
  const keyProps = (note: Notes) => ({
    'data-octave': octave,
    'data-note': note,
    className: cls({ pressed: pressed.includes(note) }),
  });

  return (
    <Root style={{ '--key-width': `${keyWidth}px`, '--key-height': `${keyHeight}px` } as React.CSSProperties}>
      <KeyWhite {...keyProps('C')} />
      <KeyBlack {...keyProps('C#')} />
      <KeyWhiteOffset {...keyProps('D')} />
      <KeyBlack {...keyProps('D#')} />
      <KeyWhiteOffset {...keyProps('E')} />
      <KeyWhite {...keyProps('F')} />
      <KeyBlack {...keyProps('F#')} />
      <KeyWhiteOffset {...keyProps('G')} />
      <KeyBlack {...keyProps('G#')} />
      <KeyWhiteOffset {...keyProps('A')} />
      <KeyBlack {...keyProps('A#')} />
      <KeyWhiteOffset {...keyProps('B')} />
    </Root>
  );
});
