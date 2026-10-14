import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Fader, FADER_TRAVEL } from './index';

// the half of the cap height: the slot and the fill start there
const BOTTOM = 6;

// jsdom has no PointerEvent: a mouse event with the pointer type name and a pointerId works for React and
// the document listeners of the pointer tracker
const pointer = (type: string, target: EventTarget, clientY: number) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY, button: 0 });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  act(() => {
    target.dispatchEvent(event);
  });
};

const setup = (props: React.ComponentProps<typeof Fader> = {}) => {
  const onChange = jest.fn();
  const result = render(<Fader min={0} max={1} precision={100} value={0.5} onChange={onChange} {...props} />);
  const slider = screen.getByRole('slider');
  const px = (testId: string, key: 'bottom' | 'height') => parseFloat(screen.getByTestId(testId).style[key]);
  return { ...result, onChange, slider, px };
};

describe('Fader', () => {
  it('is a vertical slider with its value, range, label and formatted text', () => {
    const { slider } = setup({ label: 'ER', formatValue: (value) => `${value * 100}%` });
    const attr = (name: string) => slider.getAttribute(name);
    expect(attr('aria-orientation')).toBe('vertical');
    expect(attr('aria-valuemin')).toBe('0');
    expect(attr('aria-valuemax')).toBe('1');
    expect(attr('aria-valuenow')).toBe('0.5');
    expect(attr('aria-valuetext')).toBe('50%');
    expect(attr('tabindex')).toBe('0');
    expect(screen.getByRole('slider', { name: 'ER' })).toBe(slider);
    expect(screen.getByText('ER')).toBeDefined();
  });

  it('puts the cap at the value, from the bottom up', () => {
    const { px, rerender } = setup({ value: 0 });
    expect(px('fader-cap', 'bottom')).toBe(0);
    rerender(<Fader min={0} max={1} value={0.5} />);
    expect(px('fader-cap', 'bottom')).toBe(FADER_TRAVEL / 2);
    rerender(<Fader min={0} max={1} value={1} />);
    expect(px('fader-cap', 'bottom')).toBe(FADER_TRAVEL);
  });

  it('fills from the bottom to the value, no fill at min', () => {
    const { px, rerender } = setup({ value: 0.5 });
    expect(px('fader-fill', 'bottom')).toBe(BOTTOM);
    expect(px('fader-fill', 'height')).toBe(FADER_TRAVEL / 2);
    rerender(<Fader min={0} max={1} value={0} />);
    expect(screen.queryByTestId('fader-fill')).toBeNull();
  });

  it('fills from fillFrom in both directions and marks it on the scale', () => {
    const { px, rerender } = setup({ min: 0, max: 2, value: 1, fillFrom: 1 });
    expect(screen.queryByTestId('fader-fill')).toBeNull();
    expect(screen.getAllByTestId('fader-mark')).toHaveLength(1);
    expect(screen.getAllByTestId('fader-tick')).toHaveLength(10);

    rerender(<Fader min={0} max={2} value={1.5} fillFrom={1} />);
    expect(px('fader-fill', 'bottom')).toBe(BOTTOM + FADER_TRAVEL / 2);
    expect(px('fader-fill', 'height')).toBe(FADER_TRAVEL / 4);

    rerender(<Fader min={0} max={2} value={0.5} fillFrom={1} />);
    expect(px('fader-fill', 'bottom')).toBe(BOTTOM + FADER_TRAVEL / 4);
    expect(px('fader-fill', 'height')).toBe(FADER_TRAVEL / 4);
  });

  it('has an even scale without fillFrom', () => {
    setup();
    expect(screen.getAllByTestId('fader-tick')).toHaveLength(11);
    expect(screen.queryByTestId('fader-mark')).toBeNull();
  });

  it('places the cap on a log scale', () => {
    const { px } = setup({ min: 20, max: 20000, mode: 'log', value: Math.sqrt(20 * 20000) });
    expect(px('fader-cap', 'bottom')).toBeCloseTo(FADER_TRAVEL / 2);
  });

  it.each([
    ['ArrowUp', 0.51],
    ['ArrowRight', 0.51],
    ['ArrowDown', 0.49],
    ['ArrowLeft', 0.49],
    ['PageUp', 0.6],
    ['PageDown', 0.4],
    ['Home', 0],
    ['End', 1],
  ])('%s sets %p', (key, value) => {
    const { slider, onChange } = setup();
    fireEvent.keyDown(slider, { key });
    expect(onChange).toHaveBeenCalledWith(value);
  });

  it('stops at the ends and ignores other keys', () => {
    const { slider, onChange, rerender } = setup({ value: 1 });
    fireEvent.keyDown(slider, { key: 'ArrowUp' });
    fireEvent.keyDown(slider, { key: 'End' });
    fireEvent.keyDown(slider, { key: 'a' });
    rerender(<Fader min={0} max={1} precision={100} value={0} onChange={onChange} />);
    fireEvent.keyDown(slider, { key: 'PageDown' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a key moves by one unit when its step is below the precision', () => {
    const { slider, onChange } = setup({ precision: 10 });
    fireEvent.keyDown(slider, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalledWith(0.6);
  });

  it('steps a log fader by its position', () => {
    const { slider, onChange } = setup({ min: 20, max: 20000, mode: 'log', precision: 1, value: 632 });
    fireEvent.keyDown(slider, { key: 'PageUp' });
    // 10% of the travel up a 3 decade scale: × 10^0.3
    expect(onChange.mock.lastCall?.[0]).toBeCloseTo(632 * 10 ** 0.3, -1);
  });

  it('drags the cap relative to where it was pressed, rounded and clamped', () => {
    const { onChange } = setup({ value: 0.2, precision: 10 });
    const cap = screen.getByTestId('fader-cap');
    pointer('pointerdown', cap, 100);
    // pressing the cap doesn't move it
    expect(onChange).not.toHaveBeenCalled();
    pointer('pointermove', document, 100 - FADER_TRAVEL / 2);
    expect(onChange).toHaveBeenLastCalledWith(0.7);
    // one px more rounds to the same value: no change
    pointer('pointermove', document, 100 - FADER_TRAVEL / 2 - 1);
    expect(onChange).toHaveBeenCalledTimes(1);
    pointer('pointermove', document, 300);
    expect(onChange).toHaveBeenLastCalledWith(0);
    pointer('pointerup', document, 300);
    pointer('pointermove', document, 0);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('pressing the slot jumps the cap there, then follows the pointer', () => {
    const { onChange } = setup({ value: 0 });
    const slot = screen.getByTestId('fader-slot');
    jest
      .spyOn(slot, 'getBoundingClientRect')
      .mockReturnValue({ top: 100, bottom: 100 + FADER_TRAVEL, height: FADER_TRAVEL } as DOMRect);
    pointer('pointerdown', slot, 100 + FADER_TRAVEL / 4);
    expect(onChange).toHaveBeenLastCalledWith(0.75);
    pointer('pointermove', document, 100);
    expect(onChange).toHaveBeenLastCalledWith(1);
    pointer('pointerup', document, 100);
  });

  // like the label of a knob: holding it shows the value, dragging from it moves relative to the value
  it("pressing the label doesn't jump, dragging from it moves relative", () => {
    const { onChange } = setup({ value: 0.5, label: 'Sep' });
    const slot = screen.getByTestId('fader-slot');
    jest
      .spyOn(slot, 'getBoundingClientRect')
      .mockReturnValue({ top: 100, bottom: 100 + FADER_TRAVEL, height: FADER_TRAVEL } as DOMRect);
    const label = screen.getByText('Sep');
    pointer('pointerdown', label, 100 + FADER_TRAVEL + 20);
    expect(onChange).not.toHaveBeenCalled();
    pointer('pointermove', document, 100 + FADER_TRAVEL + 20 - FADER_TRAVEL / 4);
    expect(onChange).toHaveBeenLastCalledWith(0.75);
    pointer('pointerup', document, 0);
  });

  it('is greyed out and out of the tab order while disabled', () => {
    const { slider } = setup({ disabled: true });
    expect(slider.parentElement?.classList.contains('disabled')).toBe(true);
    expect(slider.getAttribute('tabindex')).toBe('-1');
    expect(slider.getAttribute('aria-disabled')).toBe('true');
  });
});
