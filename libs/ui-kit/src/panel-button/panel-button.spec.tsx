import React from 'react';
import { act, render, screen } from '@testing-library/react';
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

  describe('label overflow', () => {
    let resize: () => void = () => undefined;
    const OriginalResizeObserver = window.ResizeObserver;
    beforeAll(() => {
      window.ResizeObserver = class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {
          resize();
        }
        disconnect() {
          resize = () => undefined;
        }
      } as unknown as typeof ResizeObserver;
    });
    afterAll(() => {
      window.ResizeObserver = OriginalResizeObserver;
    });

    // the button is `width` wide, the label needs 40px and gets the button width minus 30px
    const setWidth = (button: HTMLElement, width: number) => {
      const label = button.querySelector('span') as HTMLElement;
      Object.defineProperty(button, 'clientWidth', { configurable: true, value: width });
      Object.defineProperty(label, 'scrollWidth', { configurable: true, value: 40 });
      Object.defineProperty(label, 'clientWidth', {
        configurable: true,
        get: () => (label.classList.contains('hidden') ? 1 : Math.min(40, width - 30)),
      });
      return label;
    };

    it('hides the label when it does not fit next to the icon and shows it when it does again', () => {
      const { rerender } = render(<PanelButton>Save</PanelButton>);
      const button = screen.getByRole('button', { name: 'Save' });
      const label = setWidth(button, 100);
      rerender(<PanelButton icon={<svg />}>Save</PanelButton>);
      expect(label.classList.contains('hidden')).toBe(false);

      setWidth(button, 50); // the label gets 20px of 40
      act(() => resize());
      expect(label.classList.contains('hidden')).toBe(true);
      // still the accessible name
      expect(screen.getByRole('button', { name: 'Save' })).toBe(button);

      setWidth(button, 69);
      act(() => resize());
      expect(label.classList.contains('hidden')).toBe(true);

      setWidth(button, 70);
      act(() => resize());
      expect(label.classList.contains('hidden')).toBe(false);
    });

    it('never hides the label without an icon', () => {
      render(<PanelButton>Save</PanelButton>);
      const label = setWidth(screen.getByRole('button', { name: 'Save' }), 50);
      act(() => resize());
      expect(label.classList.contains('hidden')).toBe(false);
    });
  });
});
