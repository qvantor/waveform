import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { drawn } from '../common/test-utils/canvas';
import { withElementSize } from '../common/test-utils/element-size';
import type { HandleModulation } from '../handle';
import { DragValue } from './index';

// jsdom has no PointerEvent: a mouse event with the pointer type name and a pointerId works for React and
// the document listeners of the pointer tracker
const pointer = (
  type: string,
  target: EventTarget,
  [clientX, clientY]: [number, number],
  button = 0,
  init: MouseEventInit = {}
) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button, ...init });
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

  it('shows the arrows of a value stepping by whole numbers after it with arrows, none without', () => {
    const { slider, rerender } = setup({ value: 3, min: 1, max: 8, precision: 1, formatValue: undefined });
    expect(slider.querySelectorAll('[role="img"]')).toHaveLength(0);
    rerender(<DragValue label='Rand' value={3} min={1} max={8} precision={1} arrows onChange={jest.fn()} />);
    const arrows = slider.querySelectorAll('[role="img"]');
    expect([...arrows].map((arrow) => arrow.getAttribute('aria-label'))).toEqual(['caret-up', 'caret-down']);
    expect(slider.textContent).toBe('Rand3');
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

const modulation = (amount: number, id = 'env2', selected = true): HandleModulation => ({
  id,
  color: '#f1c40f',
  amount,
  label: id,
  selected,
});

// the line of the routes: as wide as the field
const WIDTH = 100;

// Semi: whole semitones of ±12
const semi = (props: Partial<React.ComponentProps<typeof DragValue>> = {}) => (
  <DragValue label='Semi' value={0} min={-12} max={12} precision={1} onChange={jest.fn()} {...props} />
);

describe('DragValue with routes', () => {
  let restore: () => void;
  beforeEach(() => {
    restore = withElementSize(WIDTH, 4);
  });
  afterEach(() => {
    restore();
    jest.useRealTimers();
  });

  const bar = () => {
    const { left, width } = screen.getByTestId('mod-bar').style;
    return [left, width];
  };

  it('without routes to take has no line, no dot nor its place, no drop target', () => {
    const { container } = render(semi());
    expect(screen.queryByTestId('mod-track')).toBeNull();
    expect(screen.queryByTestId('mod-dot-slot')).toBeNull();
    expect(screen.queryByTestId('amount-dot')).toBeNull();
    expect(container.querySelector('[data-mod-target]')).toBeNull();
  });

  it('keeps the place of the dot right of the value before the first route: the dot comes into it', () => {
    const { rerender } = render(semi({ arrows: true, modulations: [] }));
    const field = screen.getByRole('slider', { name: 'Semi' });
    const slot = screen.getByTestId('mod-dot-slot');
    expect(slot.parentElement).toBe(field);
    const [, down] = field.querySelectorAll('[role="img"]');
    expect(down.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(slot.childElementCount).toBe(0);
    rerender(semi({ arrows: true, modulations: [modulation(0.25)] }));
    expect(screen.getByTestId('mod-dot-slot')).toBe(slot);
    expect(slot.contains(screen.getByRole('slider', { name: 'env2' }))).toBe(true);
  });

  it('takes routes: a drop target, the line of its range, the dot right of the value in its row', () => {
    const { container, rerender } = render(semi({ value: 7, modTarget: 'osc1.pitch', modulations: [] }));
    expect(container.querySelector('[data-mod-target="osc1.pitch"]')).not.toBeNull();
    expect(screen.getByTestId('mod-track')).toBeDefined();
    expect(screen.queryByTestId('mod-bar')).toBeNull();
    expect(screen.queryByTestId('amount-dot')).toBeNull();

    rerender(
      semi({
        value: 7,
        modTarget: 'osc1.pitch',
        arrows: true,
        modulations: [modulation(0.25), modulation(-1, 'env3', false)],
      })
    );
    expect(screen.getAllByTestId('mod-bar')).toHaveLength(1);
    expect(screen.getByTestId('mod-bar').style.background).toBe('rgb(241, 196, 15)');
    // the value stays its own
    expect(screen.getByRole('slider', { name: 'Semi' }).getAttribute('aria-valuetext')).toBe('7');
    expect(screen.getAllByTestId('amount-dot')).toHaveLength(1);
    expect(screen.getAllByTestId('amount-dot-section')).toHaveLength(2);
    const dot = screen.getByRole('slider', { name: 'env2' });
    const field = screen.getByRole('slider', { name: 'Semi' });
    expect(field.contains(dot)).toBe(true);
    const [, down] = field.querySelectorAll('[role="img"]');
    expect(down.compareDocumentPosition(dot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the bar of the selected route goes from the value by its share of the range, up to an end', () => {
    // Semi 0 is the middle of its line; +0.25 of Pitch (12 of its 48 semitones) half the 24 of Semi
    const { rerender } = render(semi({ modulations: [modulation(0.25)], modSpan: 2 }));
    expect(bar()).toEqual(['50%', '50%']);
    // from +6, three quarters: stops at the end
    rerender(semi({ value: 6, modulations: [modulation(0.25)], modSpan: 2 }));
    expect(bar()).toEqual(['75%', '25%']);
    // a bipolar one around the value, ± half its share
    rerender(semi({ modulations: [{ ...modulation(0.25), bipolar: true }], modSpan: 2 }));
    expect(bar()).toEqual(['25%', '50%']);
    // without modSpan an amount is a share of the range, as of a knob
    rerender(semi({ value: -12, modulations: [modulation(0.25)] }));
    expect(bar()).toEqual(['0%', '25%']);
    // Fine: -1 is 100 of its 200 cents, from -50 down to the end
    rerender(
      <DragValue
        label='Fine'
        value={-50}
        min={-100}
        max={100}
        precision={1}
        modulations={[modulation(-1)]}
        modSpan={0.5}
      />
    );
    expect(bar()).toEqual(['0%', '25%']);
    // no route of the selected source: no bar, the dot only shows the routes
    rerender(semi({ modulations: [modulation(1, 'env2', false)] }));
    expect(screen.queryByTestId('mod-bar')).toBeNull();
    expect(screen.getByRole('img', { name: 'env2' })).toBeDefined();
  });

  it('dragging the dot of the selected route changes its amount, not the value', () => {
    const onChange = jest.fn();
    const onAmount = jest.fn();
    render(semi({ onChange, modulations: [{ ...modulation(0.25), onChange: onAmount, amountSteps: 48 }] }));
    pointer('pointerdown', screen.getByRole('slider', { name: 'env2' }), [100, 100]);
    pointer('pointermove', document, [100, 85]);
    pointer('pointerup', document, [100, 85]);
    expect(onChange).not.toHaveBeenCalled();
    expect(onAmount).toHaveBeenLastCalledWith(19 / 48);
  });

  it('Shift+Alt+click switches the polarity of the selected route, the value stays', () => {
    const onChange = jest.fn();
    const onPolarity = jest.fn();
    render(semi({ onChange, modulations: [{ ...modulation(0.25), onPolarity }] }));
    pointer('pointerdown', screen.getByRole('slider', { name: 'Semi' }), [100, 100], 0, {
      shiftKey: true,
      altKey: true,
    });
    pointer('pointermove', document, [100, 50]);
    expect(onPolarity).toHaveBeenCalledWith(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a light dot on the line follows the live routes from the value, within the line, hidden without a level', () => {
    jest.useFakeTimers();
    let level: number | null = 1;
    const live = (amount: number, id = 'env2') => ({
      ...modulation(amount, id),
      level: () => level,
      live: true,
    });
    const { rerender } = render(semi({ modulations: [live(0.25), live(-0.125, 'env3')], modSpan: 2 }));
    const mark = screen.getByTestId('value-mod-mark');
    expect(mark.style.width).toBe(`${WIDTH}px`);
    // the center of the dot, as high as the line
    const x = () => {
      const [dot, ...rest] = drawn(mark);
      expect(rest).toEqual([]);
      expect([dot.op, dot.alpha, dot.style]).toEqual(['fill', 0.9, '#fff']);
      const [{ x, y, radius }] = dot.arcs;
      expect([y, radius]).toEqual([2, 2]);
      return x;
    };
    // the middle + (0.25 - 0.125) × 2 of the range (in steps of a thousandth of it: within half a px)
    expect(x()).toBeCloseTo(WIDTH * 0.75, 0);
    level = 0.5;
    act(() => {
      jest.advanceTimersByTime(20);
    });
    expect(x()).toBeCloseTo(WIDTH * 0.625, 0);
    // within the line: a radius in from its end
    rerender(semi({ value: 12, modulations: [live(1), live(1, 'env3')], modSpan: 2 }));
    level = 1;
    act(() => {
      jest.advanceTimersByTime(20);
    });
    expect(x()).toBeCloseTo(WIDTH - 2, 0);
    level = null;
    act(() => {
      jest.advanceTimersByTime(20);
    });
    expect(drawn(mark)).toEqual([]);
    // no live route: no canvas
    rerender(semi({ modulations: [modulation(1)] }));
    expect(screen.queryByTestId('value-mod-mark')).toBeNull();
  });
});
