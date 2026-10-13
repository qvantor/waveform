import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ModeSwitch } from './index';

const options = [
  { id: 'a', label: 'Alpha', icon: <svg data-testid='icon-a' /> },
  { id: 'b', label: 'Beta', icon: <svg data-testid='icon-b' /> },
  { id: 'c', label: 'Gamma' },
];

const setup = (value: string, disabled?: boolean) => {
  const onChange = jest.fn();
  const user = userEvent.setup();
  render(<ModeSwitch options={options} value={value} onChange={onChange} disabled={disabled} />);
  return { onChange, user };
};

describe('ModeSwitch', () => {
  it('shows the label and the icon of the current option', () => {
    setup('b');
    expect(screen.getByRole('button', { name: 'Beta' }).textContent).toContain('Beta');
    expect(screen.queryByTestId('icon-b')).not.toBeNull();
    expect(screen.queryByTestId('icon-a')).toBeNull();
  });

  it('renders without an icon', () => {
    setup('c');
    expect(screen.getByRole('button', { name: 'Gamma' })).toBeDefined();
  });

  it('marks the position of the current option', () => {
    setup('b');
    const dots = screen.getAllByTestId('mode-switch-dot');
    expect(dots).toHaveLength(3);
    expect(dots.map((dot) => dot.classList.contains('current'))).toEqual([false, true, false]);
  });

  it('steps to the neighbours', async () => {
    const { user, onChange } = setup('b');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(onChange).toHaveBeenLastCalledWith('c');
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(onChange).toHaveBeenLastCalledWith('a');
  });

  it('wraps from the first to the last', async () => {
    const { user, onChange } = setup('a');
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(onChange).toHaveBeenLastCalledWith('c');
  });

  it('wraps from the last to the first', async () => {
    const { user, onChange } = setup('c');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(onChange).toHaveBeenLastCalledWith('a');
  });

  it('goes to the next option on a click on the screen', async () => {
    const { user, onChange } = setup('a');
    await user.click(screen.getByRole('button', { name: 'Alpha' }));
    expect(onChange).toHaveBeenLastCalledWith('b');
  });

  it('falls back to the first option for an unknown value', () => {
    setup('x');
    expect(screen.getByRole('button', { name: 'Alpha' })).toBeDefined();
  });

  it('does nothing while disabled', () => {
    const { onChange } = setup('a', true);
    const buttons = screen.getAllByRole('button') as HTMLButtonElement[];
    expect(buttons.every((button) => button.disabled)).toBe(true);
    // fireEvent: user-event refuses to click through pointer-events: none
    buttons.forEach((button) => fireEvent.click(button));
    expect(onChange).not.toHaveBeenCalled();
  });
});
