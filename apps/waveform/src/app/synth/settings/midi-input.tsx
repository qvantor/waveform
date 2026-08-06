import { MdPiano } from 'react-icons/md';
import styled from 'styled-components';
import { Label, Select, PanelButton } from '@waveform/ui-kit';
import { useState } from 'react';
import { Popover } from 'antd';
import { useBehaviorSubject } from '@waveform/rxjs-react';
import { useMidiController } from '../common/modules';

const Content = styled.div`
  min-width: 300px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const ALL_CHANNELS = 'all';
// midi always exposes 16 channels per input, there is no way to know which of them are in use
const channelOptions = [
  { name: 'All channels', value: ALL_CHANNELS },
  ...Array.from({ length: 16 }, (_, i) => ({ name: `Channel ${i + 1}`, value: String(i) })),
];

export const MidiInput = () => {
  const [open, setOpen] = useState(false);
  const [{ $midiInputs, $selectedInputId, $selectedChannel }, { selectMidiInput, selectMidiChannel }] =
    useMidiController();
  const midiInputs = useBehaviorSubject($midiInputs);
  const selected = useBehaviorSubject($selectedInputId);
  const selectedChannel = useBehaviorSubject($selectedChannel);
  return (
    <Popover
      trigger='click'
      placement='bottom'
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
          <Label>Midi channel</Label>
          <Select
            value={selectedChannel === null ? ALL_CHANNELS : String(selectedChannel)}
            options={channelOptions}
            onChange={(value) => selectMidiChannel(value === ALL_CHANNELS ? null : Number(value))}
          />
        </Content>
      }
      open={open}
      onOpenChange={setOpen}
    >
      <PanelButton icon={<MdPiano />} active={open} indicator={selected !== null}>
        Midi
      </PanelButton>
    </Popover>
  );
};
