import React from 'react';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Section } from './index';

describe('Section', () => {
  it('renders the name, the extra content and the children', () => {
    render(
      <Section name='Delay' extra={<button>Preset</button>}>
        content
      </Section>
    );
    expect(screen.getByText('Delay')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Preset' })).toBeTruthy();
    expect(screen.getByText('content')).toBeTruthy();
  });

  it('clicking the header calls onClick, clicking the extra content does not', async () => {
    const onClick = jest.fn();
    const onExtra = jest.fn();
    const user = userEvent.setup();
    render(<Section name='Delay' onClick={onClick} extra={<button onClick={onExtra}>Preset</button>} />);

    await user.click(screen.getByRole('button', { name: 'Preset' }));
    expect(onExtra).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delay' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('the title is a toggle button with the active state, also usable from the keyboard', async () => {
    const onClick = jest.fn();
    const user = userEvent.setup();
    const { rerender } = render(<Section name='Delay' active onClick={onClick} />);
    const title = screen.getByRole('button', { name: 'Delay' });
    expect(title.getAttribute('aria-pressed')).toBe('true');

    title.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);

    rerender(<Section name='Delay' active={false} onClick={onClick} />);
    expect(title.getAttribute('aria-pressed')).toBe('false');
  });

  it('without onClick the title is not a button', () => {
    render(<Section name='Voicing' />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
