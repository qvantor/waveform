import React from 'react';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Lamp } from './index';

describe('Lamp', () => {
  it('shows the state through aria-pressed and the on class', () => {
    const { rerender } = render(<Lamp on={false} label='Power' />);
    const lamp = screen.getByRole('button', { name: 'Power' });
    expect(lamp.getAttribute('aria-pressed')).toBe('false');
    expect(lamp.classList.contains('on')).toBe(false);

    rerender(<Lamp on label='Power' />);
    expect(lamp.getAttribute('aria-pressed')).toBe('true');
    expect(lamp.classList.contains('on')).toBe(true);
  });

  it('is small by default, size m makes it bigger', () => {
    const { rerender } = render(<Lamp on={false} label='Power' />);
    const lamp = screen.getByRole('button', { name: 'Power' });
    expect(lamp.classList.contains('m')).toBe(false);

    rerender(<Lamp on={false} label='Power' size='m' />);
    expect(lamp.classList.contains('m')).toBe(true);
  });

  it('calls onChange with the opposite state', async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    const { rerender } = render(<Lamp on={false} label='Power' onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Power' }));
    expect(onChange).toHaveBeenLastCalledWith(true);

    rerender(<Lamp on label='Power' onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Power' }));
    expect(onChange).toHaveBeenLastCalledWith(false);
  });
});
