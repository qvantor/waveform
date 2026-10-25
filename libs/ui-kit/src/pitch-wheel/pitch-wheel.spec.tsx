import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { PitchWheel } from './index';

// jsdom has no PointerEvent: a mouse event with a pointer id, React and the document listeners read both alike
const pointer = (type: string, target: EventTarget, clientY: number, init: MouseEventInit = {}) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY, button: 0, ...init });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  act(() => {
    target.dispatchEvent(event);
  });
};

// a wheel of 112 px: the cap (12 px) travels 50 px from the middle to each end
const setup = (value = 0) => {
  const onChange = jest.fn();
  const result = render(
    <PitchWheel value={value} onChange={onChange} height={112} formatValue={(v) => `${v * 2} st`} />
  );
  const wheel = screen.getByRole('slider', { name: 'Pitch bend' });
  const capTop = () => parseFloat(screen.getByTestId('pitch-wheel-cap').style.top);
  Object.assign(Element.prototype, { hasPointerCapture: () => false });
  return { ...result, onChange, wheel, capTop };
};

afterEach(() => Reflect.deleteProperty(Element.prototype, 'hasPointerCapture'));

describe('PitchWheel', () => {
  it('shows the value it is given: the cap in the middle at rest, half its travel up at 0.5', () => {
    const { capTop, rerender, onChange } = setup();
    expect(capTop()).toBe(56);
    rerender(<PitchWheel value={0.5} onChange={onChange} height={112} />);
    expect(capTop()).toBe(31);
    expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('0.5');
  });

  it('follows a drag up and down within -1..1 and springs back to 0 once let go', () => {
    const { wheel, onChange } = setup();
    pointer('pointerdown', wheel, 100);
    pointer('pointermove', document, 75, { buttons: 1 });
    expect(onChange).toHaveBeenLastCalledWith(0.5);
    pointer('pointermove', document, 300, { buttons: 1 });
    expect(onChange).toHaveBeenLastCalledWith(-1);
    pointer('pointerup', document, 300);
    expect(onChange).toHaveBeenLastCalledWith(0);
    // let go: a move changes nothing
    pointer('pointermove', document, 0, { buttons: 1 });
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('drags from where it is (a bend of a MIDI input)', () => {
    const { wheel, onChange } = setup(0.5);
    pointer('pointerdown', wheel, 100);
    pointer('pointermove', document, 110, { buttons: 1 });
    expect(onChange).toHaveBeenLastCalledWith(0.3);
  });

  it('springs back when the window loses focus or its pointerup was lost', () => {
    const { wheel, onChange } = setup();
    pointer('pointerdown', wheel, 100);
    pointer('pointermove', document, 90, { buttons: 1 });
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(onChange).toHaveBeenLastCalledWith(0);

    pointer('pointerdown', wheel, 100);
    pointer('pointermove', document, 90, { buttons: 1 });
    pointer('pointermove', document, 80, { buttons: 0 });
    expect(onChange.mock.calls.map(([value]) => value)).toEqual([0.2, 0, 0.2, 0]);
  });

  it('while held shows its name and the value in the tooltip', () => {
    const tooltip = () => document.getElementById('tooltip')?.textContent ?? '';
    const { wheel } = setup(0.25);
    pointer('pointerdown', wheel, 100);
    expect(tooltip()).toBe('Pitch bend0.5 st');
    pointer('pointerup', document, 100);
  });
});
