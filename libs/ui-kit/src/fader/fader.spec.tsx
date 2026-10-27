import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { drawn } from '../common/test-utils/canvas';
import { Fader, FADER_TRAVEL } from './index';

// the half of the cap height: the slot and the fill start there
const BOTTOM = 6;
// the height of the body
const HEIGHT = 64;

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

  it('while held shows the full name of what it changes before the value, its accessible name', () => {
    const tooltip = () => document.getElementById('tooltip')?.textContent ?? '';
    const { slider } = setup({
      label: 'ER',
      name: 'Early reflections',
      formatValue: (value) => `${value * 100}%`,
    });
    expect(screen.getByRole('slider', { name: 'Early reflections' })).toBe(slider);
    expect(tooltip()).toBe('');
    pointer('pointerdown', screen.getByTestId('fader-cap'), 100);
    expect(tooltip()).toBe('Early reflections50%');
    pointer('pointerup', document, 100);
    expect(tooltip()).toBe('');
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

describe('Fader modulation', () => {
  const modulation = (amount: number, id = 'env2', selected = true) => ({
    id,
    color: '#f1c40f',
    amount,
    label: id,
    selected,
  });

  it('draws a bar of the selected route from the value to the value + amount, clamped, and the dot', () => {
    const { rerender } = render(
      <Fader min={0} max={1} value={0.5} modulations={[modulation(0.25), modulation(-0.75, 'env3', false)]} />
    );
    const [up] = screen.getAllByTestId('mod-bar');
    expect(screen.getAllByTestId('mod-bar')).toHaveLength(1);
    expect(up.style.background).toBe('rgb(241, 196, 15)');
    expect(parseFloat(up.style.bottom)).toBe(BOTTOM + FADER_TRAVEL / 2);
    expect(parseFloat(up.style.height)).toBe(FADER_TRAVEL / 4);
    expect(screen.getAllByTestId('amount-dot')).toHaveLength(1);
    expect(screen.getByRole('slider', { name: 'env2' })).toBeDefined();
    rerender(
      <Fader
        min={0}
        max={1}
        value={0.5}
        modulations={[modulation(0.25, 'env2', false), modulation(-0.75, 'env3')]}
      />
    );
    const [down] = screen.getAllByTestId('mod-bar');
    expect(parseFloat(down.style.bottom)).toBe(BOTTOM);
    expect(parseFloat(down.style.height)).toBe(FADER_TRAVEL / 2);
    // no route of the selected source: no bar, the dot only shows the routes
    rerender(<Fader min={0} max={1} value={0.5} modulations={[modulation(0.25, 'env2', false)]} />);
    expect(screen.queryByTestId('mod-bar')).toBeNull();
    expect(screen.getByRole('img', { name: 'env2' }).getAttribute('data-testid')).toBe('amount-dot');
    expect(screen.getAllByTestId('amount-dot-section')).toHaveLength(1);
  });

  // over the track above the slot: as a press there it would jump to the max
  it("pressing the dot of the routes doesn't jump, dragging from it moves relative", () => {
    const onChange = jest.fn();
    render(
      <Fader
        min={0}
        max={1}
        precision={100}
        value={0.5}
        onChange={onChange}
        modulations={[modulation(0.25, 'env2', false)]}
      />
    );
    const slot = screen.getByTestId('fader-slot');
    jest
      .spyOn(slot, 'getBoundingClientRect')
      .mockReturnValue({ top: 100, bottom: 100 + FADER_TRAVEL, height: FADER_TRAVEL } as DOMRect);
    pointer('pointerdown', screen.getByRole('img', { name: 'env2' }), 96);
    expect(onChange).not.toHaveBeenCalled();
    pointer('pointermove', document, 96 - FADER_TRAVEL / 4);
    expect(onChange).toHaveBeenLastCalledWith(0.75);
    pointer('pointerup', document, 0);
  });

  it('a mark follows the sum of the live routes from the value, clamped, hidden without a level', () => {
    jest.useFakeTimers();
    let level: number | null = 1;
    const live = (amount: number, id = 'env2') => ({
      ...modulation(amount, id),
      level: () => level,
      live: true,
    });
    const { rerender } = render(
      <Fader min={0} max={1} value={0.5} modulations={[live(0.25), live(-0.5, 'env3')]} />
    );
    const mark = screen.getByTestId('fader-mod-mark');
    // the value line of the cap painted where the cap would be: its bottom over the body's
    const bottom = () => {
      const [line, ...rest] = drawn(mark);
      expect(rest).toEqual([]);
      expect([line.op, line.lineWidth, line.lineCap, line.alpha]).toEqual(['stroke', 2, 'round', 0.5]);
      return HEIGHT - BOTTOM - line.points[0][1];
    };
    // 0.5 + 0.25 - 0.5
    expect(bottom()).toBeCloseTo(FADER_TRAVEL / 4);
    level = 0.5;
    act(() => {
      jest.advanceTimersByTime(20);
    });
    expect(bottom()).toBeCloseTo((FADER_TRAVEL * 3) / 8);
    rerender(<Fader min={0} max={1} value={0.5} modulations={[live(1)]} />);
    level = 1;
    act(() => {
      jest.advanceTimersByTime(20);
    });
    expect(bottom()).toBeCloseTo(FADER_TRAVEL);
    level = null;
    act(() => {
      jest.advanceTimersByTime(20);
    });
    expect(drawn(mark)).toEqual([]);
    // no live route: no canvas
    rerender(<Fader min={0} max={1} value={0.5} modulations={[modulation(1)]} />);
    expect(screen.queryByTestId('fader-mod-mark')).toBeNull();
    jest.useRealTimers();
  });

  it('is a drop target unless disabled, then its routes are hidden', () => {
    const { container, rerender } = render(
      <Fader min={0} max={1} value={0.5} modTarget='reverb.er' modulations={[modulation(0.25)]} />
    );
    expect(container.querySelector('[data-mod-target="reverb.er"]')).not.toBeNull();
    rerender(
      <Fader min={0} max={1} value={0.5} disabled modTarget='reverb.er' modulations={[modulation(0.25)]} />
    );
    expect(container.querySelector('[data-mod-target]')).toBeNull();
    expect(screen.queryByTestId('mod-bar')).toBeNull();
    expect(screen.queryByTestId('amount-dot')).toBeNull();
  });
});
