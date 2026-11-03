import { fireEvent, render, screen } from '@testing-library/react';
import { OctaveControl } from './octave-control';

const setup = (octave: number, label?: string) => {
  const onOctaveChange = jest.fn();
  render(<OctaveControl octave={octave} range={[0, 6]} onOctaveChange={onOctaveChange} label={label} />);
  return {
    onOctaveChange,
    up: screen.getByRole('button', { name: 'Octave up' }),
    down: screen.getByRole('button', { name: 'Octave down' }),
  };
};

describe('OctaveControl', () => {
  it('shows the octave, its label as the title and the name of the group', () => {
    setup(3, 'Computer keyboard octave: Z = C3, Q = C4');
    expect(screen.getByText('C3')).toBeInTheDocument();
    const group = screen.getByRole('group', { name: 'Computer keyboard octave: Z = C3, Q = C4' });
    expect(group).toHaveAttribute('title', 'Computer keyboard octave: Z = C3, Q = C4');
  });

  it('shifts it by an octave up and down', () => {
    const { onOctaveChange, up, down } = setup(3);
    fireEvent.click(up);
    fireEvent.click(down);
    expect(onOctaveChange.mock.calls).toEqual([[4], [2]]);
  });

  it.each([
    [0, 'down'],
    [6, 'up'],
  ] as const)('is disabled at %i, the end of its range: %s', (octave, end) => {
    const buttons = setup(octave);
    expect(buttons[end]).toBeDisabled();
    expect(buttons[end === 'up' ? 'down' : 'up']).toBeEnabled();
  });
});
