import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { drawn } from '../common/test-utils/canvas';
import { withElementSize } from '../common/test-utils/element-size';
import type { HandleModulation } from '../handle';
import { DraggableNumber } from './index';

// jsdom has no PointerEvent: a mouse event with the pointer type name and a pointerId works for React and
// the document listeners of the pointer tracker
const pointer = (type: string, target: EventTarget, clientY: number, init: MouseEventInit = {}) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY, button: 0, ...init });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  act(() => {
    target.dispatchEvent(event);
  });
};

const modulation = (amount: number, id = 'env2', selected = true): HandleModulation => ({
  id,
  color: '#f1c40f',
  amount,
  label: id,
  selected,
});

// the line of the routes is 92 px wide (a field of 100 px, 4 px in on each side)
const WIDTH = 92;

describe('DraggableNumber', () => {
  let restore: () => void;
  beforeEach(() => {
    restore = withElementSize(WIDTH, 2);
  });
  afterEach(() => {
    restore();
    jest.useRealTimers();
  });

  it('steps by a whole number every 10 px dragged up, within its range, with its carets', () => {
    const onChange = jest.fn();
    const { container } = render(
      <DraggableNumber value={0} range={[-3, 3]} label='Oct' onChange={onChange} />
    );
    expect(screen.getByText('Oct')).toBeDefined();
    expect(container.querySelectorAll('.anticon')).toHaveLength(2);
    pointer('pointerdown', screen.getByText('Oct'), 100);
    pointer('pointermove', document, 79);
    expect(onChange).toHaveBeenLastCalledWith(2);
    pointer('pointermove', document, 300);
    expect(onChange).toHaveBeenLastCalledWith(-3);
    pointer('pointerup', document, 300);
  });

  it('steps every pxPerStep px; compact without its carets', () => {
    const onChange = jest.fn();
    const { container } = render(
      <DraggableNumber value={0} range={[-100, 100]} label='Fine' pxPerStep={2} compact onChange={onChange} />
    );
    expect(container.querySelectorAll('.anticon')).toHaveLength(0);
    pointer('pointerdown', screen.getByText('Fine'), 100);
    pointer('pointermove', document, 86);
    expect(onChange).toHaveBeenLastCalledWith(7);
    pointer('pointerup', document, 86);
  });

  it('without routes to take has no line, no dot, no drop target', () => {
    const { container } = render(<DraggableNumber value={0} label='Oct' />);
    expect(screen.queryByTestId('mod-track')).toBeNull();
    expect(screen.queryByTestId('amount-dot')).toBeNull();
    expect(container.querySelector('[data-mod-target]')).toBeNull();
  });

  it('takes routes: a drop target, a line, the bar of the selected route from the middle, the dot', () => {
    const { container, rerender } = render(
      <DraggableNumber value={7} label='Semi' modTarget='osc1.pitch' modulations={[]} />
    );
    expect(container.querySelector('[data-mod-target="osc1.pitch"]')).not.toBeNull();
    expect(screen.getByTestId('mod-track')).toBeDefined();
    expect(screen.queryByTestId('mod-bar')).toBeNull();
    expect(screen.queryByTestId('amount-dot')).toBeNull();

    // +0.5: a quarter of the line right of its middle; the number stays its value
    rerender(
      <DraggableNumber
        value={7}
        label='Semi'
        modTarget='osc1.pitch'
        modulations={[modulation(0.5), modulation(-1, 'env3', false)]}
      />
    );
    const bar = screen.getByTestId('mod-bar');
    expect(screen.getAllByTestId('mod-bar')).toHaveLength(1);
    expect(bar.style.background).toBe('rgb(241, 196, 15)');
    expect([bar.style.left, bar.style.width]).toEqual(['50%', '25%']);
    expect(screen.getByText('7')).toBeDefined();
    expect(screen.getAllByTestId('amount-dot')).toHaveLength(1);
    expect(screen.getByRole('slider', { name: 'env2' })).toBeDefined();
    expect(screen.getAllByTestId('amount-dot-section')).toHaveLength(2);

    // -1 to the left end; a bipolar one around the middle, ±a quarter of its amount
    rerender(<DraggableNumber value={7} label='Semi' modulations={[modulation(-1)]} />);
    expect([screen.getByTestId('mod-bar').style.left, screen.getByTestId('mod-bar').style.width]).toEqual([
      '0%',
      '50%',
    ]);
    rerender(<DraggableNumber value={7} label='Semi' modulations={[{ ...modulation(1), bipolar: true }]} />);
    expect([screen.getByTestId('mod-bar').style.left, screen.getByTestId('mod-bar').style.width]).toEqual([
      '25%',
      '50%',
    ]);
    // no route of the selected source: no bar, the dot only shows the routes
    rerender(<DraggableNumber value={7} label='Semi' modulations={[modulation(1, 'env2', false)]} />);
    expect(screen.queryByTestId('mod-bar')).toBeNull();
    expect(screen.getByRole('img', { name: 'env2' })).toBeDefined();
  });

  it('dragging the dot of the selected route changes its amount, not the value', () => {
    const onChange = jest.fn();
    const onAmount = jest.fn();
    render(
      <DraggableNumber
        value={0}
        label='Semi'
        range={[-12, 12]}
        onChange={onChange}
        modulations={[{ ...modulation(0.25), onChange: onAmount, amountSteps: 48 }]}
      />
    );
    pointer('pointerdown', screen.getByRole('slider', { name: 'env2' }), 100);
    pointer('pointermove', document, 85);
    pointer('pointerup', document, 85);
    expect(onChange).not.toHaveBeenCalled();
    expect(onAmount).toHaveBeenLastCalledWith(19 / 48);
  });

  it('Shift+Alt+click switches the polarity of the selected route, the value stays', () => {
    const onChange = jest.fn();
    const onPolarity = jest.fn();
    render(
      <DraggableNumber
        value={0}
        label='Fine'
        onChange={onChange}
        modulations={[{ ...modulation(0.25), onPolarity }]}
      />
    );
    pointer('pointerdown', screen.getByText('Fine'), 100, { shiftKey: true, altKey: true });
    pointer('pointermove', document, 50);
    expect(onPolarity).toHaveBeenCalledWith(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a mark follows the sum of the live routes from the middle, ±1 at the ends, hidden without a level', () => {
    jest.useFakeTimers();
    let level: number | null = 1;
    const live = (amount: number, id = 'env2') => ({
      ...modulation(amount, id),
      level: () => level,
      live: true,
    });
    const { rerender } = render(
      <DraggableNumber value={0} label='Semi' modulations={[live(0.5), live(-0.25, 'env3')]} />
    );
    const mark = screen.getByTestId('number-mod-mark');
    expect(mark.style.width).toBe(`${WIDTH}px`);
    // the middle of the tick across the line
    const x = () => {
      const [tick, ...rest] = drawn(mark);
      expect(rest).toEqual([]);
      expect([tick.op, tick.alpha]).toEqual(['fill', 0.5]);
      const [[left, , width]] = tick.rects;
      return left + width / 2;
    };
    // the middle + (0.5 - 0.25) / 2 of the line (in steps of a thousandth of it: within half a px)
    expect(x()).toBeCloseTo(WIDTH * 0.625, 0);
    level = 0.5;
    act(() => {
      jest.advanceTimersByTime(20);
    });
    expect(x()).toBeCloseTo(WIDTH * 0.5625, 0);
    // clamped within the line
    rerender(<DraggableNumber value={0} label='Semi' modulations={[live(-1), live(-1, 'env3')]} />);
    level = 1;
    act(() => {
      jest.advanceTimersByTime(20);
    });
    expect(x()).toBeCloseTo(1, 0);
    level = null;
    act(() => {
      jest.advanceTimersByTime(20);
    });
    expect(drawn(mark)).toEqual([]);
    // no live route: no canvas
    rerender(<DraggableNumber value={0} label='Semi' modulations={[modulation(1)]} />);
    expect(screen.queryByTestId('number-mod-mark')).toBeNull();
  });
});
