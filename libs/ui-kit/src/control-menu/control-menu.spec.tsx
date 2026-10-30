import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Handle, HandleModulation } from '../handle';
import { Fader } from '../fader';
import { DragValue } from '../drag-value';
import { DraggableNumber } from '../draggable-number';
import { withElementSize } from '../common/test-utils/element-size';

// jsdom has no PointerEvent: a mouse event with the pointer type and a pointerId works for React and the document
// listeners of the pointer tracker
const pointer = (
  type: string,
  target: EventTarget,
  [clientX, clientY]: [number, number] = [0, 0],
  pointerType = 'mouse'
) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0 });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  act(() => {
    target.dispatchEvent(event);
  });
};

const longPress = () =>
  act(() => {
    jest.advanceTimersByTime(600);
  });

const menu = () => screen.queryByRole('dialog');

const route = (id: string, props: Partial<HandleModulation> = {}): HandleModulation => ({
  id,
  color: '#1663c7',
  amount: 0.5,
  label: id.toUpperCase(),
  onChange: jest.fn(),
  onRemove: jest.fn(),
  onPolarity: jest.fn(),
  onOff: jest.fn(),
  ...props,
});

// a knob of 0..100 at 30 (its default 50) with the routes given; its root is the parent of its label
const setup = (props: Partial<React.ComponentProps<typeof Handle>> = {}) => {
  const onChange = jest.fn();
  const onClearModulations = jest.fn();
  const view = render(
    <Handle
      min={0}
      max={100}
      value={30}
      label='Cutoff'
      name='Filter cutoff'
      formatValue={(value) => `${value} Hz`}
      defaultValue={50}
      onChange={onChange}
      onClearModulations={onClearModulations}
      {...props}
    />
  );
  const knob = screen.getByText('Cutoff').parentElement as HTMLElement;
  return { ...view, knob, onChange, onClearModulations };
};

describe('the menu of a control', () => {
  afterEach(() => jest.useRealTimers());

  it('opens on a right click of a knob: its name and value, a row of each route, Default and Clear modulation', () => {
    const routes = [
      route('env2', { selected: true }),
      route('lfo1', { bipolar: true, off: true, amount: -0.4 }),
    ];
    const { knob } = setup({ modulations: routes });
    expect(menu()).toBeNull();
    // the menu of the browser doesn't open
    expect(fireEvent.contextMenu(knob)).toBe(false);
    const dialog = screen.getByRole('dialog', { name: 'Filter cutoff' });
    expect(dialog.textContent).toContain('Filter cutoff30 Hz');
    const rows = within(dialog).getAllByTestId('menu-route');
    expect(rows.map((row) => row.textContent)).toEqual(['ENV250%UniBi', 'LFO1±40%UniBi']);
    // a route switched off: its lamp off, its row faded
    expect(within(rows[0]).getByRole('button', { name: 'ENV2 on' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(within(rows[1]).getByRole('button', { name: 'LFO1 on' }).getAttribute('aria-pressed')).toBe(
      'false'
    );
    expect(rows[1].classList.contains('off')).toBe(true);
    expect(within(dialog).getByRole('button', { name: /Default/ }).textContent).toBe('Default50 Hz');
    expect(within(dialog).getByRole('button', { name: 'Clear modulation' })).toBeTruthy();
  });

  it('switches a route on and off, its polarity, removes it; it stays open', () => {
    const env2 = route('env2');
    const lfo1 = route('lfo1', { bipolar: true, off: true });
    const { knob } = setup({ modulations: [env2, lfo1] });
    fireEvent.contextMenu(knob);
    fireEvent.click(screen.getByRole('button', { name: 'ENV2 on' }));
    expect(env2.onOff).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'LFO1 on' }));
    expect(lfo1.onOff).toHaveBeenCalledWith(false);
    const polarity = (id: string) => within(screen.getByRole('group', { name: `${id} polarity` }));
    fireEvent.click(polarity('ENV2').getByRole('button', { name: 'Bi' }));
    expect(env2.onPolarity).toHaveBeenCalledWith(true);
    // the polarity it has already: nothing
    fireEvent.click(polarity('LFO1').getByRole('button', { name: 'Bi' }));
    fireEvent.click(polarity('LFO1').getByRole('button', { name: 'Uni' }));
    expect(lfo1.onPolarity).toHaveBeenCalledTimes(1);
    expect(lfo1.onPolarity).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole('button', { name: 'Remove LFO1' }));
    expect(lfo1.onRemove).toHaveBeenCalledTimes(1);
    expect(menu()).not.toBeNull();
  });

  it('a row dragged changes the amount of its route: right or up raises it, by 1%, within ±100%', () => {
    const env2 = route('env2', { amount: 0.5 });
    const lfo1 = route('lfo1', { amount: -0.4, bipolar: true, off: true });
    const { knob, onChange, rerender } = setup({ modulations: [env2, lfo1] });
    fireEvent.contextMenu(knob);
    const slider = screen.getByRole('slider', { name: 'ENV2 amount' });
    expect(slider.getAttribute('aria-valuenow')).toBe('50');
    // its line: from the middle by the amount, of the color of the source
    const fills = screen.getAllByTestId('menu-route-amount');
    expect([fills[0].style.left, fills[0].style.width]).toEqual(['50%', '25%']);
    expect([fills[1].style.left, fills[1].style.width]).toEqual(['30%', '20%']);

    pointer('pointerdown', slider, [100, 100]);
    expect(slider.classList.contains('active')).toBe(true);
    // 20 px right, 10 px up: +30 px of 200 for -100%..+100%
    pointer('pointermove', document, [120, 90]);
    expect(env2.onChange).toHaveBeenLastCalledWith(0.8);
    pointer('pointermove', document, [120.4, 90]);
    expect(env2.onChange).toHaveBeenCalledTimes(1);
    pointer('pointermove', document, [400, 100]);
    expect(env2.onChange).toHaveBeenLastCalledWith(1);
    pointer('pointerup', document, [400, 100]);
    expect(slider.classList.contains('active')).toBe(false);
    // the knob doesn't turn, the menu stays open
    expect(onChange).not.toHaveBeenCalled();
    expect(menu()).not.toBeNull();

    // a route switched off keeps its amount and is dragged all the same, from the amount it has now
    rerender(
      <Handle
        min={0}
        max={100}
        value={30}
        label='Cutoff'
        defaultValue={50}
        onChange={onChange}
        modulations={[env2, { ...lfo1, amount: -0.2 }]}
      />
    );
    const lfo = screen.getByRole('slider', { name: 'LFO1 amount' });
    expect(lfo.getAttribute('aria-valuetext')).toBe('±20%');
    pointer('pointerdown', lfo, [100, 100]);
    pointer('pointermove', document, [100, 150]);
    expect(lfo1.onChange).toHaveBeenLastCalledWith(-0.7);
    pointer('pointerup', document, [100, 150]);
  });

  it('Default sets the default within the range and closes, it is disabled at the default', () => {
    const { knob, onChange, rerender } = setup({ modulations: [] });
    fireEvent.contextMenu(knob);
    fireEvent.click(screen.getByRole('button', { name: /Default/ }));
    expect(onChange).toHaveBeenCalledWith(50);
    expect(menu()).toBeNull();
    // a range that doesn't hold it (the resonance of a bandpass): its end
    rerender(<Handle min={60} max={100} value={70} label='Cutoff' defaultValue={50} onChange={onChange} />);
    fireEvent.contextMenu(knob);
    fireEvent.click(screen.getByRole('button', { name: /Default/ }));
    expect(onChange).toHaveBeenLastCalledWith(60);
    rerender(<Handle min={0} max={100} value={50} label='Cutoff' defaultValue={50} onChange={onChange} />);
    fireEvent.contextMenu(knob);
    expect((screen.getByRole('button', { name: /Default/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Clear modulation removes the routes and closes; without routes there is none, a hint shows', () => {
    const { knob, onClearModulations, rerender } = setup({ modulations: [route('env2')] });
    fireEvent.contextMenu(knob);
    fireEvent.click(screen.getByRole('button', { name: 'Clear modulation' }));
    expect(onClearModulations).toHaveBeenCalledTimes(1);
    expect(menu()).toBeNull();
    rerender(
      <Handle
        min={0}
        max={100}
        value={30}
        label='Cutoff'
        modulations={[]}
        onClearModulations={onClearModulations}
      />
    );
    fireEvent.contextMenu(knob);
    expect(screen.queryByRole('button', { name: 'Clear modulation' })).toBeNull();
    expect(menu()?.textContent).toContain('Drag a source tab here');
    // no default: no Default
    expect(screen.queryByRole('button', { name: /Default/ })).toBeNull();
  });

  it('a knob that takes no modulations has only Default; one without a default nor routes no menu', () => {
    const { knob, rerender } = setup();
    fireEvent.contextMenu(knob);
    expect(screen.queryByRole('button', { name: 'Clear modulation' })).toBeNull();
    expect(screen.getByRole('button', { name: /Default/ })).toBeTruthy();
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    rerender(<Handle min={0} max={100} value={30} label='Cutoff' onChange={jest.fn()} />);
    // the right click of the browser
    expect(fireEvent.contextMenu(knob)).toBe(true);
    expect(menu()).toBeNull();
  });

  it('closes on Escape, a press out of it, a scroll; a press in it turns no knob', () => {
    const { knob, onChange } = setup({ modulations: [route('env2')] });
    fireEvent.contextMenu(knob);
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(menu()).toBeNull();

    fireEvent.contextMenu(knob);
    pointer('pointerdown', menu() as HTMLElement);
    pointer('pointermove', document, [0, -40]);
    pointer('pointerup', document, [0, -40]);
    expect(menu()).not.toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    // a press takes no focus
    expect(fireEvent.mouseDown(screen.getByRole('button', { name: 'ENV2 on' }))).toBe(false);

    pointer('pointerdown', document.body);
    expect(menu()).toBeNull();

    fireEvent.contextMenu(knob);
    act(() => {
      fireEvent.scroll(document);
    });
    expect(menu()).toBeNull();
  });

  it('opens on a long press of a finger: the knob doesn’t turn meanwhile nor after it opened', () => {
    jest.useFakeTimers();
    const { knob, onChange } = setup({ modulations: [] });
    pointer('pointerdown', knob, [10, 100], 'touch');
    // within 3 px: held still
    pointer('pointermove', document, [12, 98], 'touch');
    expect(onChange).not.toHaveBeenCalled();
    longPress();
    expect(menu()).not.toBeNull();
    pointer('pointermove', document, [10, 40], 'touch');
    pointer('pointerup', document, [10, 40], 'touch');
    expect(onChange).not.toHaveBeenCalled();
    expect(menu()).not.toBeNull();
  });

  it('a finger that moves turns the knob and opens nothing; a mouse held still opens nothing', () => {
    jest.useFakeTimers();
    const { knob, onChange } = setup({ modulations: [] });
    pointer('pointerdown', knob, [10, 100], 'touch');
    pointer('pointermove', document, [10, 80], 'touch');
    expect(onChange).toHaveBeenCalled();
    longPress();
    pointer('pointerup', document, [10, 80], 'touch');
    expect(menu()).toBeNull();

    pointer('pointerdown', knob, [10, 100]);
    longPress();
    pointer('pointerup', document, [10, 100]);
    expect(menu()).toBeNull();
  });

  it('a right click while the knob is held (Ctrl+click) takes the press: it turns the knob no more', () => {
    const { knob, onChange } = setup({ modulations: [] });
    pointer('pointerdown', knob, [10, 100]);
    fireEvent.contextMenu(knob);
    pointer('pointermove', document, [10, 40]);
    pointer('pointerup', document, [10, 40]);
    expect(onChange).not.toHaveBeenCalled();
    expect(menu()).not.toBeNull();
  });

  it('opens on a long press on the dot of the routes', () => {
    jest.useFakeTimers();
    const env2 = route('env2', { selected: true });
    setup({ modulations: [env2] });
    pointer('pointerdown', screen.getByTestId('amount-dot'), [10, 100]);
    longPress();
    pointer('pointerup', document, [10, 100]);
    expect(menu()).not.toBeNull();
    expect(env2.onRemove).not.toHaveBeenCalled();
  });

  it('opens under the control within the viewport, over it where it doesn’t fit under it', () => {
    const { knob } = setup({ modulations: [] });
    const box = knob.firstElementChild as HTMLElement;
    const rect = (top: number, left: number) =>
      jest.spyOn(box, 'getBoundingClientRect').mockReturnValue({
        top,
        left,
        bottom: top + 50,
        right: left + 50,
        width: 50,
        height: 50,
      } as DOMRect);
    jest.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(400);
    jest.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(600);
    jest.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(232);
    jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(120);
    try {
      rect(100, 175);
      fireEvent.contextMenu(knob);
      // centered under it, 6 px down
      expect([menu()?.style.left, menu()?.style.top]).toEqual(['84px', '156px']);
      act(() => {
        fireEvent.keyDown(document, { key: 'Escape' });
      });
      // at the right edge and the bottom: within 8 px of the edge, over it
      rect(500, 380);
      fireEvent.contextMenu(knob);
      expect([menu()?.style.left, menu()?.style.top]).toEqual(['160px', '374px']);
    } finally {
      jest.restoreAllMocks();
    }
  });
});

describe('the menu of the other controls', () => {
  afterEach(() => jest.useRealTimers());

  it('of a fader: a finger on its track jumps there once let go still, held it opens the menu', () => {
    jest.useFakeTimers();
    const onChange = jest.fn();
    render(<Fader min={0} max={1} value={0.5} label='Depth' defaultValue={0.3} onChange={onChange} />);
    const slot = screen.getByTestId('fader-slot');
    jest.spyOn(slot, 'getBoundingClientRect').mockReturnValue({ bottom: 100, height: 100 } as DOMRect);
    pointer('pointerdown', slot, [0, 10], 'touch');
    expect(onChange).not.toHaveBeenCalled();
    pointer('pointerup', document, [0, 10], 'touch');
    expect(onChange).toHaveBeenCalledWith(0.9);

    pointer('pointerdown', slot, [0, 80], 'touch');
    longPress();
    pointer('pointerup', document, [0, 80], 'touch');
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Default/ }));
    expect(onChange).toHaveBeenLastCalledWith(0.3);
  });

  it('of a value of a strip: its routes and Default', () => {
    const restore = withElementSize(60, 4);
    const onChange = jest.fn();
    const env2 = route('env2');
    render(
      <DragValue
        label='Semi'
        value={7}
        min={-12}
        max={12}
        defaultValue={0}
        onChange={onChange}
        modulations={[env2]}
      />
    );
    fireEvent.contextMenu(screen.getByRole('slider', { name: 'Semi' }));
    expect(screen.getByRole('dialog', { name: 'Semi' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove ENV2' }));
    expect(env2.onRemove).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Default/ }));
    expect(onChange).toHaveBeenCalledWith(0);
    restore();
  });

  it('of a number: Default', () => {
    const onChange = jest.fn();
    render(
      <DraggableNumber
        value={3}
        range={[1, 12]}
        label='Poly'
        name='Voices'
        defaultValue={8}
        onChange={onChange}
      />
    );
    fireEvent.contextMenu(screen.getByText('Poly').parentElement as HTMLElement);
    expect(screen.getByRole('dialog', { name: 'Voices' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Default/ }));
    expect(onChange).toHaveBeenCalledWith(8);
  });
});
