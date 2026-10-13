import { act, fireEvent, render, screen } from '@testing-library/react';
import { BehaviorSubject } from 'rxjs';
import { MidiInput } from './midi-input';

const mockMidiInputs = new BehaviorSubject<WebMidi.MIDIInput[]>([]);
const mockSelectedInputId = new BehaviorSubject<string | null>(null);

jest.mock('../../common/modules', () => ({
  useMidiController: () => [
    { $midiInputs: mockMidiInputs, $selectedInputId: mockSelectedInputId },
    { selectMidiInput: jest.fn() },
  ],
}));

beforeEach(() => {
  mockSelectedInputId.next(null);
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
});
