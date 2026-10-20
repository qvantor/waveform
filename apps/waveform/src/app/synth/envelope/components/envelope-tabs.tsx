import React from 'react';
import styled from 'styled-components';
import cls from 'classnames';
import { MdDragIndicator } from 'react-icons/md';
import { ENVELOPES, EnvelopeId } from '@waveform/preset-schema';
import { startModDrag, theme } from '@waveform/ui-kit';
import { ENVELOPE_COLORS, ENVELOPE_LABELS } from '../envelope-colors';

// the whole header (a plain one): a segmented control on its grey, as high as the other headers
const Root = styled.div`
  flex: 1 1;
  min-width: 0;
  display: flex;
  gap: 2px;
  padding: 2px;
`;

// a third of the header each, its label white as the titles of the other headers, after a dot of the color of
// its envelope (the color of its routes on the knobs). The selected one is a white key with a dark label
const Tab = styled.button`
  flex: 1 1 0;
  min-width: 0;
  height: 17px;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font: inherit;
  color: ${theme.colors.white};
  background: none;
  border: none;
  border-radius: 2px;
  padding: 0 6px;
  cursor: pointer;
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
  transition: background 120ms, color 120ms;

  &:hover {
    background: rgba(255, 255, 255, 0.25);
  }

  &.selected {
    color: ${theme.colors.primaryDarkMediumContrast};
    background: ${theme.colors.white};
    box-shadow: 0 1px 1px rgba(0, 0, 0, 0.12);
    cursor: grab;
  }

  /* never an outline: the selected one is a white key */
  &:focus,
  &:focus-visible {
    outline: none;
  }
`;

// a white ring around it: the colors are about as dark as the grey of the header
const Dot = styled.span`
  flex: none;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  box-shadow: 0 0 0 2px ${theme.colors.white};
`;

// the grip of the selected tab, in its right corner: the label stays centered
const Grip = styled(MdDragIndicator)`
  position: absolute;
  right: 3px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 13px;
  color: ${theme.colors.primaryMediumContrast};
`;

interface Props {
  selected: EnvelopeId;
  onSelect: (id: EnvelopeId) => void;
  // a tab dragged onto a knob: its envelope modulates it
  onDrop?: (id: EnvelopeId, target: string) => void;
}

// ENV 1 | ENV 2 | ENV 3 in the header of the section: the envelope its chart shows and its knobs edit, the knobs
// show its routes. A tab dragged onto a knob assigns its envelope to it (a click selects it), the grip of the
// selected one tells it
export const EnvelopeTabs = ({ selected, onSelect, onDrop }: Props) => (
  <Root role='tablist' aria-label='Envelopes'>
    {ENVELOPES.map((id) => (
      <Tab
        key={id}
        type='button'
        role='tab'
        aria-selected={id === selected}
        className={cls({ selected: id === selected })}
        onClick={() => onSelect(id)}
        onPointerDown={(e) =>
          onDrop &&
          startModDrag(e, {
            label: ENVELOPE_LABELS[id],
            color: ENVELOPE_COLORS[id],
            onDrop: (target) => onDrop(id, target),
          })
        }
      >
        <Dot aria-hidden style={{ background: ENVELOPE_COLORS[id] }} />
        {ENVELOPE_LABELS[id]}
        {id === selected && <Grip aria-hidden data-testid='env-grip' />}
      </Tab>
    ))}
  </Root>
);
