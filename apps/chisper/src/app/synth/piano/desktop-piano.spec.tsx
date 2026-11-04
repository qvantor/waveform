import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { withElementSize } from '@chisper/ui-kit/test-utils';
import { AppProvider, useApp } from '../../app';
import { InputControllerProvider, KeyboardControllerProvider, useInputController } from '../common/modules';
import { DesktopPiano } from './desktop-piano';

// the wheel reads the synth: not what these specs are about
jest.mock('../pitch-bend', () => ({ PitchBend: () => null }));

const KeyboardController = ({ children }: React.PropsWithChildren) => (
  <KeyboardControllerProvider initial={{}} app={useApp()} inputController={useInputController()}>
    {children}
  </KeyboardControllerProvider>
);

let restoreSize: () => unknown = () => undefined;
afterEach(() => restoreSize());

// the piano with the keys `width` px wide
const setup = (width: number) => {
  restoreSize = withElementSize(width, 100);
  const { container } = render(
    <AppProvider initial={{}}>
      <InputControllerProvider initial={{}}>
        <KeyboardController>
          <DesktopPiano />
        </KeyboardController>
      </InputControllerProvider>
    </AppProvider>
  );
  // the octaves of the keys shown, by the labels of their C
  const octaves = () => [...container.querySelectorAll('[data-note="C"]')].map((key) => key.textContent);
  const key = (octave: number, note: string) =>
    container.querySelector(`[data-octave="${octave}"][data-note="${note}"]`) as HTMLElement;
  const group = () => screen.getByRole('group', { name: /^Computer keyboard octave/ });
  return { octaves, key, group };
};

const keyboard = (type: 'keydown' | 'keyup', code: string) =>
  act(() => {
    document.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true }));
  });

describe('DesktopPiano', () => {
  it('shows the octaves that fit from the one under the bottom row of the computer keyboard', () => {
    const { octaves, group } = setup(800);
    expect(octaves()).toEqual(['C2', 'C3', 'C4']);
    expect(group()).toHaveAccessibleName('Computer keyboard octave: Z = C3, Q = C4');
  });

  it.each([
    [300, 1],
    [1400, 5],
  ])('%i px of keys take %i octaves', (width, count) => {
    const { octaves } = setup(width);
    expect(octaves()).toHaveLength(count);
  });

  it('▲ and ▼ shift the octave of the computer keyboard, the piano follows it', () => {
    const { octaves, group } = setup(800);
    fireEvent.click(screen.getByRole('button', { name: 'Octave up' }));
    expect(group()).toHaveAccessibleName('Computer keyboard octave: Z = C4, Q = C5');
    expect(octaves()).toEqual(['C3', 'C4', 'C5']);
    fireEvent.click(screen.getByRole('button', { name: 'Octave down' }));
    fireEvent.click(screen.getByRole('button', { name: 'Octave down' }));
    expect(octaves()).toEqual(['C1', 'C2', 'C3']);
  });

  it('↑ and ↓ of the computer keyboard shift it too', () => {
    const { octaves, group } = setup(800);
    keyboard('keydown', 'ArrowUp');
    expect(group()).toHaveAccessibleName('Computer keyboard octave: Z = C4, Q = C5');
    expect(octaves()).toEqual(['C3', 'C4', 'C5']);
  });

  it('lights the key of a note of the computer keyboard until its keyup', () => {
    const { key } = setup(800);
    keyboard('keydown', 'KeyZ');
    expect(key(3, 'C')).toHaveClass('pressed');
    keyboard('keyup', 'KeyZ');
    expect(key(3, 'C')).not.toHaveClass('pressed');
  });
});
