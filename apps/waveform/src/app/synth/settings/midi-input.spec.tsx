import { act, fireEvent, render, screen } from '@testing-library/react';
import { BehaviorSubject } from 'rxjs';
import { MidiInput } from './midi-input';

const mockMidiInputs = new BehaviorSubject<WebMidi.MIDIInput[]>([]);
const mockSelectedInputId = new BehaviorSubject<string | null>(null);
const mockSelectedChannel = new BehaviorSubject<number | null>(null);
const mockSelectMidiChannel = jest.fn();

jest.mock('../common/modules', () => ({
  useMidiController: () => [
    {
      $midiInputs: mockMidiInputs,
      $selectedInputId: mockSelectedInputId,
      $selectedChannel: mockSelectedChannel,
    },
    { selectMidiInput: jest.fn(), selectMidiChannel: mockSelectMidiChannel },
  ],
}));

const openChannelSelect = async () => {
  render(<MidiInput />);
  fireEvent.click(screen.getByRole('button', { name: 'Midi' }));
  expect(await screen.findByText('Midi channel')).toBeInTheDocument();
  // the source select has no inputs, so the only other combobox is the channel one
  return screen.getAllByRole('combobox')[1] as HTMLSelectElement;
};

beforeEach(() => {
  mockSelectedInputId.next(null);
  mockSelectedChannel.next(null);
});

describe('MidiInput', () => {
  it('is a labeled key, lit while the popover is open', async () => {
    render(<MidiInput />);
    const button = screen.getByRole('button', { name: 'Midi' });
    expect(button.classList.contains('active')).toBe(false);

    fireEvent.click(button);
    expect(await screen.findByText('Midi source')).toBeInTheDocument();
    expect(button.classList.contains('active')).toBe(true);
  });

  it('shows the indicator while an input is selected', () => {
    render(<MidiInput />);
    expect(screen.queryByTestId('panel-button-indicator')).not.toBeInTheDocument();

    act(() => mockSelectedInputId.next('keys'));
    expect(screen.getByTestId('panel-button-indicator')).toBeInTheDocument();
  });

  it('listens to all channels by default, any of the 16 can be chosen', async () => {
    const select = await openChannelSelect();
    expect(select.value).toBe('all');
    expect(screen.getByDisplayValue('All channels')).toBe(select);
    expect(Array.from(select.options, (option) => option.text)).toEqual([
      'All channels',
      ...Array.from({ length: 16 }, (_, i) => `Channel ${i + 1}`),
    ]);
  });

  it('shows the selected channel, 0 is Channel 1', async () => {
    mockSelectedChannel.next(0);
    const select = await openChannelSelect();
    expect(screen.getByDisplayValue('Channel 1')).toBe(select);

    act(() => mockSelectedChannel.next(9));
    expect(screen.getByDisplayValue('Channel 10')).toBe(select);
  });

  it('selects a channel by its index, All channels as null', async () => {
    mockSelectedChannel.next(3);
    const select = await openChannelSelect();

    fireEvent.change(select, { target: { value: '0' } });
    expect(mockSelectMidiChannel).toHaveBeenLastCalledWith(0);

    fireEvent.change(select, { target: { value: 'all' } });
    expect(mockSelectMidiChannel).toHaveBeenLastCalledWith(null);
    expect(mockSelectMidiChannel).toHaveBeenCalledTimes(2);
  });
});
