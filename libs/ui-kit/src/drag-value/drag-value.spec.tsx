import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { DragValue } from './index';

// jsdom has no PointerEvent: a mouse event with the pointer type name and a pointerId works for React and
// the document listeners of the pointer tracker
const pointer = (type: string, target: EventTarget, [clientX, clientY]: [number, number], button = 0) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  act(() => {
    target.dispatchEvent(event);
  });
};

const setup = (props: Partial<React.ComponentProps<typeof DragValue>> = {}) => {
  const onChange = jest.fn();
  const onActiveChange = jest.fn();
  const result = render(
    <DragValue
      label='Rand'
      value={0.5}
      precision={100}
      formatValue={(value) => `${Math.round(value * 100)}%`}
      onChange={onChange}
      onActiveChange={onActiveChange}
      {...props}
    />
  );
  const slider = screen.getByRole('slider');
  // drags from the middle of the screen by dx, dy (screen coordinates: y grows down)
  const drag = (...moves: [number, number][]) => {
    pointer('pointerdown', slider, [100, 100]);
    moves.forEach(([dx, dy]) => pointer('pointermove', document, [100 + dx, 100 + dy]));
    pointer('pointerup', document, [0, 0]);
  };
  const last = () => onChange.mock.calls.at(-1)?.[0];
  return { ...result, onChange, onActiveChange, slider, drag, last };
};

describe('DragValue', () => {
  it('is a slider with its value, range, label and formatted text', () => {
    const { slider } = setup();
    const attr = (name: string) => slider.getAttribute(name);
    expect(attr('aria-valuemin')).toBe('0');
    expect(attr('aria-valuemax')).toBe('1');
    expect(attr('aria-valuenow')).toBe('0.5');
    expect(attr('aria-valuetext')).toBe('50%');
    expect(attr('tabindex')).toBe('0');
    expect(screen.getByRole('slider', { name: 'Rand' })).toBe(slider);
    expect(slider.textContent).toBe('Rand50%');
    expect(slider.classList.contains('editable')).toBe(true);
  });

  it('only shows the value without onChange', () => {
    render(<DragValue label='Wave' value={3} formatValue={(value) => `${value + 1}/8`} />);
    expect(screen.queryByRole('slider')).toBeNull();
    // no move cursor and no hover: it can't be dragged
    expect(screen.getByText('4/8').parentElement?.classList.contains('editable')).toBe(false);
  });

  it('rises dragged right or up and falls dragged left or down, the whole range over the travel', () => {
    const { drag, last } = setup();
    drag([50, 0]);
    expect(last()).toBe(0.75);
    drag([0, -50]);
    expect(last()).toBe(0.75);
    drag([-50, 0]);
    expect(last()).toBe(0.25);
    drag([0, 50]);
    expect(last()).toBe(0.25);
  });

  it('adds up both directions of a diagonal drag', () => {
    const { drag, last } = setup();
    drag([20, -20]);
    expect(last()).toBe(0.7);
    drag([30, 10]);
    expect(last()).toBe(0.6);
  });

  it('drags from the value it had when pressed, by the travel and the precision', () => {
    const { drag, last } = setup({ min: 0, max: 10, value: 2, precision: 1, travel: 100 });
    drag([14, 0], [26, 0]);
    expect(last()).toBe(5);
  });

  it('stops at the ends of the range', () => {
    const { drag, last } = setup();
    drag([500, 0]);
    expect(last()).toBe(1);
    drag([-500, 0]);
    expect(last()).toBe(0);
  });

  it('goes on from the other end when cyclic', () => {
    const { drag, last } = setup({ value: 0, precision: 360, cyclic: true });
    drag([-50, 0]);
    expect(last()).toBe(0.75);
    drag([450, 0]);
    expect(last()).toBe(0.25);
  });

  it('turns max into min when cyclic', () => {
    const { drag, last } = setup({ value: 0.25, precision: 360, cyclic: true });
    drag([150, 0]);
    expect(last()).toBe(0);
  });

  it('calls onChange only when the value changes', () => {
    const { drag, onChange } = setup();
    drag([0.4, 0], [1.4, 0], [1.6, 0], [2.4, 0], [3.8, 0]);
    expect(onChange.mock.calls).toEqual([[0.51], [0.52]]);
  });

  it('tells when a pointer holds it and lets it go', () => {
    const { slider, onActiveChange } = setup();
    pointer('pointerdown', slider, [100, 100]);
    expect(onActiveChange.mock.calls).toEqual([[true]]);
    expect(slider.classList.contains('active')).toBe(true);
    pointer('pointerup', document, [100, 100]);
    expect(onActiveChange.mock.calls).toEqual([[true], [false]]);
    expect(slider.classList.contains('active')).toBe(false);
  });

  it('ignores other mouse buttons', () => {
    const { slider, onChange, onActiveChange } = setup();
    pointer('pointerdown', slider, [100, 100], 2);
    pointer('pointermove', document, [150, 100]);
    pointer('pointerup', document, [150, 100]);
    expect(onChange).not.toHaveBeenCalled();
    expect(onActiveChange).not.toHaveBeenCalled();
  });

  it('steps by its precision with the arrows and by a tenth of the range with page up/down', () => {
    const { slider, last } = setup();
    fireEvent.keyDown(slider, { key: 'ArrowUp' });
    expect(last()).toBe(0.51);
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(last()).toBe(0.49);
    fireEvent.keyDown(slider, { key: 'PageUp' });
    expect(last()).toBe(0.6);
    fireEvent.keyDown(slider, { key: 'PageDown' });
    expect(last()).toBe(0.4);
  });

  it('wraps the keyboard steps when cyclic', () => {
    const { slider, last } = setup({ value: 0, precision: 360, cyclic: true });
    fireEvent.keyDown(slider, { key: 'ArrowDown' });
    expect(last()).toBeCloseTo(359 / 360, 10);
  });
});
