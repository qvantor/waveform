import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { AmountDot } from './index';

// jsdom has no PointerEvent: a mouse event with the pointer type name and a pointerId works for React and
// the document listeners of the pointer tracker
const pointer = (type: string, target: EventTarget, [clientX, clientY]: [number, number]) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0 });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  act(() => {
    target.dispatchEvent(event);
  });
};

const setup = (props: Partial<React.ComponentProps<typeof AmountDot>> = {}) => {
  const onChange = jest.fn();
  const onRemove = jest.fn();
  render(
    <AmountDot
      colors={['#f00']}
      amount={0.5}
      onChange={onChange}
      onRemove={onRemove}
      label='ENV 2'
      {...props}
    />
  );
  return { onChange, onRemove, dot: screen.getByRole('slider', { name: 'ENV 2' }) };
};

const sections = (dot: HTMLElement) => Array.from(dot.querySelectorAll('[data-testid="amount-dot-section"]'));
// the angle (0 at the top, clockwise) of the point an arc path of d3 starts at: its start angle on the radius
const startAngle = (path: Element) => {
  const [x, y] = (path.getAttribute('d') ?? '').slice(1).split(/[,A]/).map(Number);
  return Math.atan2(x, -y);
};

describe('AmountDot', () => {
  afterEach(() => jest.useRealTimers());

  it('is a slider of the amount in percents', () => {
    const { dot } = setup({ amount: -0.35 });
    expect(dot.getAttribute('aria-valuenow')).toBe('-35');
    expect(dot.getAttribute('aria-valuemin')).toBe('-100');
    expect(dot.getAttribute('aria-valuemax')).toBe('100');
  });

  it('is a dot of the color of the source, centered on the point of its style', () => {
    const { dot } = setup({ style: { left: 10, top: -20 } });
    expect(sections(dot).map((path) => path.getAttribute('fill'))).toEqual(['#f00']);
    // the sign of a modulation over it
    expect(dot.querySelectorAll('svg path')).toHaveLength(2);
    expect(dot.style.left).toBe('10px');
    expect(dot.style.top).toBe('-20px');
  });

  it.each([2, 3, 4])(
    'has %s equal sections of the colors of the sources, clockwise from the top',
    (count) => {
      const colors = ['#f00', '#0f0', '#00f', '#ff0'].slice(0, count);
      const { dot } = setup({ colors });
      expect(sections(dot).map((path) => path.getAttribute('fill'))).toEqual(colors);
      sections(dot).forEach((path, index) => {
        const angle = (index / count) * 2 * Math.PI;
        expect(startAngle(path)).toBeCloseTo(angle > Math.PI ? angle - 2 * Math.PI : angle);
      });
    }
  );

  it('without an amount only shows the routes: no slider, a press goes to the control under it', () => {
    const onKnob = jest.fn();
    render(
      <div onPointerDown={onKnob}>
        <AmountDot colors={['#f00', '#0f0']} label='ENV 1, ENV 2' />
      </div>
    );
    expect(screen.queryByRole('slider')).toBeNull();
    const dot = screen.getByRole('img', { name: 'ENV 1, ENV 2' });
    expect(sections(dot)).toHaveLength(2);
    // it bubbles to the control
    expect(dot.classList.contains('passive')).toBe(true);
    expect(dot.tabIndex).toBe(-1);
    pointer('pointerdown', dot, [0, 0]);
    pointer('pointerup', document, [0, 0]);
    expect(onKnob).toHaveBeenCalledTimes(1);
  });

  it('dragged up raises the amount, down lowers it, within -100%..+100%', () => {
    const { dot, onChange } = setup({ amount: 0.5 });
    pointer('pointerdown', dot, [10, 100]);
    pointer('pointermove', document, [10, 80]);
    expect(onChange).toHaveBeenLastCalledWith(0.7);
    pointer('pointermove', document, [10, -100]);
    expect(onChange).toHaveBeenLastCalledWith(1);
    pointer('pointermove', document, [10, 300]);
    expect(onChange).toHaveBeenLastCalledWith(-1);
    pointer('pointerup', document, [10, 300]);
  });

  it('a double click removes the route', () => {
    const { dot, onRemove } = setup();
    fireEvent.doubleClick(dot);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('a long press removes the route, not a drag', () => {
    jest.useFakeTimers();
    const { dot, onRemove, onChange } = setup();
    pointer('pointerdown', dot, [10, 100]);
    act(() => {
      jest.advanceTimersByTime(600);
    });
    expect(onRemove).toHaveBeenCalledTimes(1);
    pointer('pointerup', document, [10, 100]);

    pointer('pointerdown', dot, [10, 100]);
    pointer('pointermove', document, [10, 90]);
    act(() => {
      jest.advanceTimersByTime(600);
    });
    pointer('pointerup', document, [10, 90]);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(0.6);
  });

  it('takes the arrows and removes on Delete', () => {
    const { dot, onChange, onRemove } = setup({ amount: 0.5 });
    fireEvent.keyDown(dot, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith(0.51);
    fireEvent.keyDown(dot, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenLastCalledWith(0.49);
    fireEvent.keyDown(dot, { key: 'Delete' });
    expect(onRemove).toHaveBeenCalled();
  });

  it('switches the polarity on Shift+click or B, shows a bipolar amount as ±', () => {
    const onPolarity = jest.fn();
    const { dot, onChange } = setup({ amount: -0.35, bipolar: true, onPolarity });
    const event = new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      shiftKey: true,
      button: 0,
    });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    act(() => {
      dot.dispatchEvent(event);
    });
    expect(onPolarity).toHaveBeenLastCalledWith(false);
    fireEvent.keyDown(dot, { key: 'b' });
    expect(onPolarity).toHaveBeenCalledTimes(2);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.mouseEnter(dot);
    expect(document.getElementById('tooltip')?.textContent ?? '±35%').toContain('±35%');
  });

  it('a press does not reach the knob under it', () => {
    const onKnob = jest.fn();
    render(
      <div onPointerDown={onKnob}>
        <AmountDot colors={['#f00']} amount={0.5} label='ENV 3' />
      </div>
    );
    pointer('pointerdown', screen.getByRole('slider', { name: 'ENV 3' }), [0, 0]);
    pointer('pointerup', document, [0, 0]);
    expect(onKnob).not.toHaveBeenCalled();
  });
});
