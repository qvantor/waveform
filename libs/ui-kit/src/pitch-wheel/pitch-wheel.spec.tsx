import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { withElementSize } from '../common/test-utils/element-size';
import { PitchWheel } from './index';

// jsdom has no PointerEvent: a mouse event with a pointer id, React and the document listeners read both alike
const pointer = (type: string, target: EventTarget, clientY: number, init: MouseEventInit = {}) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY, button: 0, ...init });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  act(() => {
    target.dispatchEvent(event);
  });
};

// jsdom has no layout: a wheel of 112 px, a drum of 106 px in its slot
let restoreSize: () => void;
beforeAll(() => {
  restoreSize = withElementSize(20, 106);
});
afterAll(() => restoreSize());

// the mark follows the pointer: 53 · sin 60° = 45.9 px from the middle to each end
const setup = (value = 0) => {
  const onChange = jest.fn();
  const result = render(<PitchWheel value={value} onChange={onChange} formatValue={(v) => `${v * 2} st`} />);
  const wheel = screen.getByRole('slider', { name: 'Pitch bend' });
  // px of the middle of the mark from the top of the drum
  const markAt = () => {
    const mark = screen.getByTestId('pitch-wheel-mark');
    return Number(mark.getAttribute('y')) + Number(mark.getAttribute('height')) / 2;
  };
  Object.assign(Element.prototype, { hasPointerCapture: () => false });
  return { ...result, onChange, wheel, markAt };
};

afterEach(() => Reflect.deleteProperty(Element.prototype, 'hasPointerCapture'));

describe('PitchWheel', () => {
  it('shows the value it is given: the mark in the middle at rest, the drum turned 30° up at 0.5', () => {
    const { markAt, rerender, onChange } = setup();
    expect(markAt()).toBe(53);
    rerender(<PitchWheel value={0.5} onChange={onChange} />);
    // sin 30° of the radius above the middle
    expect(markAt()).toBeCloseTo(26.5, 9);
    expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('0.5');
  });

  it('follows a drag up and down within -1..1 and springs back to 0 once let go', () => {
    const { wheel, onChange } = setup();
    pointer('pointerdown', wheel, 100);
    pointer('pointermove', document, 75, { buttons: 1 });
    // sin⁻¹(25 / 53) of 60°
    expect(onChange).toHaveBeenLastCalledWith(0.469);
    pointer('pointermove', document, 300, { buttons: 1 });
    expect(onChange).toHaveBeenLastCalledWith(-1);
    pointer('pointerup', document, 300);
    expect(onChange).toHaveBeenLastCalledWith(0);
    // let go: a move changes nothing
    pointer('pointermove', document, 0, { buttons: 1 });
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('gives what it was dragged to, not the value it shows a frame later: a render between drops nothing', () => {
    const { wheel, onChange, rerender } = setup();
    pointer('pointerdown', wheel, 100);
    pointer('pointermove', document, 75, { buttons: 1 });
    // a render of the keys around it before the value it gave is shown
    rerender(<PitchWheel value={0} onChange={onChange} />);
    pointer('pointermove', document, 100, { buttons: 1 });
    pointer('pointermove', document, 75, { buttons: 1 });
    rerender(<PitchWheel value={0} onChange={onChange} />);
    pointer('pointerup', document, 75);
    expect(onChange.mock.calls.map(([value]) => value)).toEqual([0.469, 0, 0.469, 0]);

    // pressed and let go where it is: nothing
    pointer('pointerdown', wheel, 100);
    pointer('pointerup', document, 100);
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it('drags from where it is (a bend of a MIDI input)', () => {
    const { wheel, onChange } = setup(0.5);
    pointer('pointerdown', wheel, 100);
    pointer('pointermove', document, 110, { buttons: 1 });
    expect(onChange).toHaveBeenLastCalledWith(0.302);
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
    expect(onChange.mock.calls.map(([value]) => value)).toEqual([0.181, 0, 0.181, 0]);
  });

  it('while held shows its name and the value in the tooltip', () => {
    const tooltip = () => document.getElementById('tooltip')?.textContent ?? '';
    const { wheel } = setup(0.25);
    pointer('pointerdown', wheel, 100);
    expect(tooltip()).toBe('Pitch bend0.5 st');
    pointer('pointerup', document, 100);
  });
});
