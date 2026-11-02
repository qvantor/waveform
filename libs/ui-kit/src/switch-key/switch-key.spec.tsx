import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { SwitchKey } from './index';

describe('SwitchKey', () => {
  it('is a key pressed while it is on, its full name for screen readers', () => {
    const onChange = jest.fn();
    const { rerender } = render(<SwitchKey on={false} label='T' name='Triplets' onChange={onChange} />);
    const key = screen.getByRole('button', { name: 'Triplets' });
    expect(key.textContent).toBe('T');
    expect(key.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(key);
    expect(onChange).toHaveBeenLastCalledWith(true);
    rerender(<SwitchKey on label='T' name='Triplets' onChange={onChange} />);
    expect(key.getAttribute('aria-pressed')).toBe('true');
    expect(key.classList.contains('on')).toBe(true);
    fireEvent.click(key);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('does nothing while disabled', () => {
    const onChange = jest.fn();
    render(<SwitchKey on={false} label='BPM' onChange={onChange} disabled />);
    fireEvent.click(screen.getByRole('button', { name: 'BPM' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
