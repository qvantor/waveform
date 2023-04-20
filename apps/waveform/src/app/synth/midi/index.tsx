import { MdPiano } from 'react-icons/md';
import styled, { css } from 'styled-components';
import { Label, Select, theme } from '@waveform/ui-kit';
import React, { useState } from 'react';
import { Popover } from 'antd';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { useMidiController } from '../common/modules';

const IconButton = styled.button<{ active: boolean }>`
  border: 1px solid ${theme.colors.primaryDarkMediumContrast};
  border-radius: 3px;
  padding: 3px;
  display: flex;
  align-items: center;
  color: ${theme.colors.primary};
  cursor: pointer;

  ${({ active }) =>
    active
      ? css`
          background: ${theme.colors.secondAccent};
          box-shadow: inset 0 0 0 1px #99cbec, 0 0 3px 2px rgba(153, 203, 236, 0.5);
        `
      : css`
          background: ${theme.colors.primaryHighContrast};
        `}
  svg {
    font-size: 15px;
  }
`;

const Content = styled.div`
  min-width: 300px;
  height: 55px;
`;

export const Midi = () => {
  const [open, setOpen] = useState(false);
  const [{ $midiInputs, $selectedInputId }, { selectMidiInput }] = useMidiController();
  const midiInputs = useBehaviorSubject($midiInputs);
  const selected = useBehaviorSubject($selectedInputId);
  return (
    <Popover
      trigger='click'
      placement='left'
      content={
        <Content>
          <Label>Midi source</Label>
          <Select
            value={selected ?? ''}
            options={midiInputs.map((input) => ({
              name: `${input.manufacturer} ${input.name}`,
              value: input.id,
            }))}
            onChange={selectMidiInput}
          />
        </Content>
      }
      open={open}
      onOpenChange={setOpen}
    >
      <IconButton active={open}>
        <MdPiano />
      </IconButton>
    </Popover>
  );
};
