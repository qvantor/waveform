import React from 'react';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { PanelButton } from './index';

describe('PanelButton', () => {
  it('renders the icon and the label and fires onClick', async () => {
    const onClick = jest.fn();
    const user = userEvent.setup();
    render(
      <PanelButton icon={<svg data-testid='icon' />} onClick={onClick}>
        Save
      </PanelButton>
    );
    expect(screen.getByTestId('icon')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('marks the active state with a class', () => {
    const { rerender } = render(<PanelButton>Midi</PanelButton>);
    const button = screen.getByRole('button', { name: 'Midi' });
    expect(button.classList.contains('active')).toBe(false);

    rerender(<PanelButton active>Midi</PanelButton>);
    expect(button.classList.contains('active')).toBe(true);
  });

  it('shows the indicator only when asked', () => {
    const { rerender } = render(<PanelButton>Midi</PanelButton>);
    expect(screen.queryByTestId('panel-button-indicator')).toBeNull();

    rerender(<PanelButton indicator>Midi</PanelButton>);
    expect(screen.getByTestId('panel-button-indicator')).toBeTruthy();
  });

  it('forwards the ref and keeps the passed class name', () => {
    const ref = React.createRef<HTMLButtonElement>();
    render(
      <PanelButton ref={ref} className='custom'>
        Share
      </PanelButton>
    );
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Share' }));
    expect(ref.current?.classList.contains('custom')).toBe(true);
  });
});
