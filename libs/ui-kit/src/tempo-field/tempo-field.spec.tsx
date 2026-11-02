import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { withElementSize } from '../common/test-utils/element-size';
import { formatTempo, TempoField } from './index';

// jsdom has no PointerEvent: a mouse event with a pointerId works for React and the pointer tracker
const pointer = (type: string, target: EventTarget, [clientX, clientY]: [number, number], init = {}) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    buttons: 1,
    ...init,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  act(() => {
    target.dispatchEvent(event);
  });
};

const setup = (props: Partial<React.ComponentProps<typeof TempoField>> = {}) => {
  const onChange = jest.fn();
  render(
    <TempoField
      value={120}
      min={20}
      max={300}
      label='BPM'
      defaultValue={120}
      onChange={onChange}
      {...props}
    />
  );
  const last = () => onChange.mock.calls.at(-1)?.[0];
  return { onChange, last };
};

const field = () => screen.getByRole('slider', { name: 'Tempo' });
const drag = (moves: [number, number][], init = {}) => {
  pointer('pointerdown', field(), [100, 100]);
  moves.forEach(([dx, dy]) => pointer('pointermove', document, [100 + dx, 100 + dy], init));
  pointer('pointerup', document, [0, 0]);
};

describe('TempoField', () => {
  let restoreSize: () => void;
  beforeEach(() => (restoreSize = withElementSize(130, 40)));
  afterEach(() => restoreSize());

  it('shows the tempo with up to 2 decimals and its label', () => {
    expect([formatTempo(120), formatTempo(128.5), formatTempo(93.756)]).toEqual(['120', '128.5', '93.76']);
    setup({ value: 128.25 });
    expect(field().textContent).toBe('128.25BPM');
    expect(field().getAttribute('aria-valuetext')).toBe('128.25 BPM');
    expect(field().getAttribute('aria-valuenow')).toBe('128.25');
  });

  it('steps by 1 every 4 px dragged up or right, by 0.01 every px with Shift', () => {
    const { last } = setup();
    drag([[0, -8]]);
    expect(last()).toBe(122);
    drag([[12, 0]]);
    expect(last()).toBe(123);
    drag([[0, -25]], { shiftKey: true });
    expect(last()).toBe(120.25);
  });

  it('keeps within its range', () => {
    const { last } = setup({ value: 299 });
    drag([[0, -100]]);
    expect(last()).toBe(300);
  });

  it('steps by 1 by its arrows and the arrow keys, by 0.01 with Shift, by 10 a page', () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Faster' }));
    fireEvent.click(screen.getByRole('button', { name: 'Slower' }));
    fireEvent.keyDown(field(), { key: 'ArrowUp', shiftKey: true });
    fireEvent.keyDown(field(), { key: 'PageDown' });
    expect(onChange.mock.calls.map(([value]) => value)).toEqual([121, 119, 120.01, 110]);
  });

  it('takes a typed tempo on Enter or blur, not on Escape', () => {
    const { onChange } = setup();
    fireEvent.doubleClick(field());
    const input = screen.getByRole('textbox', { name: 'Tempo' });
    expect((input as HTMLInputElement).value).toBe('120');
    fireEvent.change(input, { target: { value: '93,5' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(93.5);
    expect(screen.queryByRole('textbox')).toBeNull();

    fireEvent.doubleClick(field());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '1000' } });
    fireEvent.blur(screen.getByRole('textbox'));
    expect(onChange).toHaveBeenLastCalledWith(300);

    fireEvent.doubleClick(field());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '60' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.doubleClick(field());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'fast' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('sets the default from its menu', () => {
    const { onChange } = setup({ value: 140 });
    fireEvent.contextMenu(field());
    fireEvent.click(screen.getByRole('button', { name: /default/i }));
    expect(onChange).toHaveBeenLastCalledWith(120);
  });

  it('has its arrows where they fit, its label under the value where it is narrower still', () => {
    // arrows, the label under the value
    restoreSize();
    restoreSize = withElementSize(110, 40);
    render(<TempoField value={120} min={20} max={300} label='BPM' onChange={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Faster' })).toBeTruthy();
    expect(field().classList.contains('stacked')).toBe(true);
    cleanup();
    // no arrows, the label beside the value
    restoreSize();
    restoreSize = withElementSize(90, 40);
    const { rerender } = render(
      <TempoField value={120} min={20} max={300} label='BPM' onChange={jest.fn()} />
    );
    expect(screen.queryByRole('button', { name: 'Faster' })).toBeNull();
    expect(field().classList.contains('stacked')).toBe(false);
    restoreSize();
    restoreSize = withElementSize(60, 40);
    rerender(<TempoField key='narrow' value={120} min={20} max={300} label='BPM' onChange={jest.fn()} />);
    expect(field().classList.contains('stacked')).toBe(true);
  });

  it('is only shown without onChange', () => {
    render(<TempoField value={128.4} min={20} max={300} label='EXT' />);
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('128.4')).toBeTruthy();
    expect(screen.getByText('EXT')).toBeTruthy();
  });
});
