import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { AmountRing } from './index';

// jsdom has no PointerEvent: a mouse event with the pointer type name and a pointerId works for React and
// the document listeners of the pointer tracker
const pointer = (type: string, target: EventTarget, [clientX, clientY]: [number, number]) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0 });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  act(() => {
    target.dispatchEvent(event);
  });
};

const setup = (props: Partial<React.ComponentProps<typeof AmountRing>> = {}) => {
  const onChange = jest.fn();
  const onRemove = jest.fn();
  render(
    <AmountRing color='#f00' amount={0.5} onChange={onChange} onRemove={onRemove} label='ENV 2' {...props} />
  );
  return { onChange, onRemove, ring: screen.getByRole('slider', { name: 'ENV 2' }) };
};

describe('AmountRing', () => {
  afterEach(() => jest.useRealTimers());

  it('is a slider of the amount in percents', () => {
    const { ring } = setup({ amount: -0.35 });
    expect(ring.getAttribute('aria-valuenow')).toBe('-35');
    expect(ring.getAttribute('aria-valuemin')).toBe('-100');
    expect(ring.getAttribute('aria-valuemax')).toBe('100');
  });

  it('draws the amount from the top, no arc at 0', () => {
    setup({ amount: 0.5 });
    expect(screen.getByTestId('amount-arc').getAttribute('fill')).toBe('#f00');
  });

  it('has no arc at 0', () => {
    setup({ amount: 0 });
    expect(screen.queryByTestId('amount-arc')).toBeNull();
  });

  it('dragged up raises the amount, down lowers it, within -100%..+100%', () => {
    const { ring, onChange } = setup({ amount: 0.5 });
    pointer('pointerdown', ring, [10, 100]);
    pointer('pointermove', document, [10, 80]);
    expect(onChange).toHaveBeenLastCalledWith(0.7);
    pointer('pointermove', document, [10, -100]);
    expect(onChange).toHaveBeenLastCalledWith(1);
    pointer('pointermove', document, [10, 300]);
    expect(onChange).toHaveBeenLastCalledWith(-1);
    pointer('pointerup', document, [10, 300]);
  });

  it('a double click removes the route', () => {
    const { ring, onRemove } = setup();
    fireEvent.doubleClick(ring);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('a long press removes the route, not a drag', () => {
    jest.useFakeTimers();
    const { ring, onRemove, onChange } = setup();
    pointer('pointerdown', ring, [10, 100]);
    act(() => {
      jest.advanceTimersByTime(600);
    });
    expect(onRemove).toHaveBeenCalledTimes(1);
    pointer('pointerup', document, [10, 100]);

    pointer('pointerdown', ring, [10, 100]);
    pointer('pointermove', document, [10, 90]);
    act(() => {
      jest.advanceTimersByTime(600);
    });
    pointer('pointerup', document, [10, 90]);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(0.6);
  });

  it('takes the arrows and removes on Delete', () => {
    const { ring, onChange, onRemove } = setup({ amount: 0.5 });
    fireEvent.keyDown(ring, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith(0.51);
    fireEvent.keyDown(ring, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenLastCalledWith(0.49);
    fireEvent.keyDown(ring, { key: 'Delete' });
    expect(onRemove).toHaveBeenCalled();
  });

  it('a press does not reach the knob under it', () => {
    const onKnob = jest.fn();
    render(
      <div onPointerDown={onKnob}>
        <AmountRing color='#f00' amount={0.5} label='ENV 3' />
      </div>
    );
    pointer('pointerdown', screen.getByRole('slider', { name: 'ENV 3' }), [0, 0]);
    pointer('pointerup', document, [0, 0]);
    expect(onKnob).not.toHaveBeenCalled();
  });

  describe('live dot', () => {
    const dot = () => screen.getByTestId('amount-dot') as unknown as SVGCircleElement;

    it('follows the level of the source on the arc every frame while live, without a render', () => {
      jest.useFakeTimers();
      let value: number | null = 0;
      const { rerender } = render(<AmountRing color='#f00' amount={0.5} level={() => value} live />);
      expect(dot().style.visibility).toBe('visible');
      // at the top for a level of 0
      expect(Number(dot().getAttribute('cx'))).toBeCloseTo(0);
      value = 1;
      act(() => {
        jest.advanceTimersByTime(20);
      });
      // half of the full arc clockwise
      expect(Number(dot().getAttribute('cx'))).toBeGreaterThan(0);
      value = null;
      act(() => {
        jest.advanceTimersByTime(20);
      });
      expect(dot().style.visibility).toBe('hidden');
      value = 0.5;
      rerender(<AmountRing color='#f00' amount={0.5} level={() => value} live={false} />);
      act(() => {
        jest.advanceTimersByTime(20);
      });
      expect(dot().style.visibility).toBe('hidden');
    });

    it('has no dot without a level', () => {
      render(<AmountRing color='#f00' amount={0.5} live />);
      expect(dot().style.visibility).toBe('hidden');
    });
  });
});
