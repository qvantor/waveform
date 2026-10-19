import React from 'react';
import styled from 'styled-components';
import cls from 'classnames';
import { ENVELOPES, EnvelopeId } from '@waveform/preset-schema';
import { startModDrag, theme } from '@waveform/ui-kit';
import { ENVELOPE_COLORS, ENVELOPE_LABELS } from '../envelope-colors';

const Root = styled.div`
  display: flex;
  gap: 2px;
  margin: -3px 0;
`;

// the header text, the selected one lit and underlined in the color of its envelope
const Tab = styled.button`
  font: inherit;
  color: rgb(255 255 255 / 65%);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 3px 6px 1px;
  cursor: pointer;
  touch-action: none;
  transition: color 150ms;

  &:hover,
  &.selected {
    color: ${theme.colors.white};
  }

  &:focus-visible {
    outline: 1px solid ${theme.colors.white};
  }
`;

interface Props {
  selected: EnvelopeId;
  onSelect: (id: EnvelopeId) => void;
  // a tab dragged onto a knob: its envelope modulates it
  onDrop?: (id: EnvelopeId, target: string) => void;
}

// ENV 1 | ENV 2 | ENV 3 in the header of the section: the envelope its chart shows and its knobs edit. A tab
// dragged onto a knob assigns its envelope to it (a click selects it)
export const EnvelopeTabs = ({ selected, onSelect, onDrop }: Props) => (
  <Root role='tablist' aria-label='Envelopes'>
    {ENVELOPES.map((id) => (
      <Tab
        key={id}
        type='button'
        role='tab'
        aria-selected={id === selected}
        className={cls({ selected: id === selected })}
        style={{ borderBottomColor: id === selected ? ENVELOPE_COLORS[id] : undefined }}
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
        {ENVELOPE_LABELS[id]}
      </Tab>
    ))}
  </Root>
);
