import { MdPiano } from 'react-icons/md';
import styled from 'styled-components';
import { Label, Select, IconButton } from '@waveform/ui-kit';
import { useState } from 'react';
import { Popover } from 'antd';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { useMidiController } from '../../common/modules';

const Content = styled.div`
  min-width: 300px;
  height: 55px;
`;

export const MidiInput = () => {
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
