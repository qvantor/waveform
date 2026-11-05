import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createTransport } from '../../../test-utils/models';
import { TransportContext } from '../common/modules/transport';
import { TempoDisplay } from './tempo-display';

// jsdom has no PointerEvent: a mouse event with the pointer type name and a pointerId works for React and the
// document listeners of the drag
const pointer = (type: string, target: EventTarget, [clientX, clientY]: [number, number], init = {}) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    button: 0,
    buttons: 1,
    ...init,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  act(() => {
    target.dispatchEvent(event);
  });
};

const setup = () => {
  const transport = createTransport();
  render(
    <TransportContext.Provider value={transport}>
      <TempoDisplay />
    </TransportContext.Provider>
  );
  // the seven segments (the carets are icons too)
  const segments = () =>
    screen.getAllByRole('img').find((img) => img.tagName.toLowerCase() === 'svg') as unknown as SVGElement;
  const shown = () => segments().getAttribute('aria-label');
  const display = () => segments().parentElement as HTMLElement;
  const field = () => screen.queryByRole('textbox', { name: 'Tempo' }) as HTMLInputElement | null;
  const drag = (moves: [number, number][], init = {}) => {
    pointer('pointerdown', display(), [100, 100]);
    moves.forEach(([dx, dy]) => pointer('pointermove', document, [100 + dx, 100 + dy], init));
    pointer('pointerup', document, [0, 0]);
  };
  return { transport, shown, display, field, drag };
};

describe('TempoDisplay', () => {
  it('shows the tempo of the field with its decimals, in BPM', () => {
    const { transport, shown } = setup();
    const [, { setBpm }] = transport;
    expect(shown()).toBe('120.00');
    expect(screen.getByText('BPM')).toBeInTheDocument();
    act(() => setBpm(128.25));
    expect(shown()).toBe('128.25');
  });

  it('a press of a caret takes no focus: the arrows and Space stay those of the page', () => {
    setup();
    ['Faster', 'Slower'].forEach((name) =>
      // false: its default (the focus) prevented
      expect(fireEvent.mouseDown(screen.getByRole('button', { name }))).toBe(false)
    );
  });

  it('steps by 1 by its carets, by 0.01 with Shift, within 30..240; the browser keeps it', () => {
    const { transport, shown } = setup();
    const [model, { setBpm }] = transport;
    fireEvent.click(screen.getByRole('button', { name: 'Faster' }));
    expect(model.$bpm.value).toBe(121);
    expect(shown()).toBe('121.00');
    expect(localStorage.getItem('tempo')).toBe('121');
    fireEvent.click(screen.getByRole('button', { name: 'Slower' }), { shiftKey: true });
    expect(model.$bpm.value).toBe(120.99);
    act(() => setBpm(239.5));
    fireEvent.click(screen.getByRole('button', { name: 'Faster' }));
    expect(model.$bpm.value).toBe(240);
    act(() => setBpm(30.5));
    fireEvent.click(screen.getByRole('button', { name: 'Slower' }));
    fireEvent.click(screen.getByRole('button', { name: 'Slower' }));
    expect(model.$bpm.value).toBe(30);
  });

  it('is dragged up or right a step of 1 every 4 px, 0.01 a px with Shift, within 30..240', () => {
    const { transport, display, drag } = setup();
    const [model] = transport;
    pointer('pointerdown', display(), [100, 100]);
    expect(display()).toHaveClass('active');
    pointer('pointermove', document, [100, 92]);
    expect(model.$bpm.value).toBe(122);
    // from where it started: 3 steps right, 1 down
    pointer('pointermove', document, [112, 104]);
    expect(model.$bpm.value).toBe(122);
    pointer('pointermove', document, [113, 100]);
    expect(model.$bpm.value).toBe(123);
    pointer('pointerup', document, [0, 0]);
    expect(display()).not.toHaveClass('active');
    drag([[0, -25]], { shiftKey: true });
    expect(model.$bpm.value).toBe(123.25);
    drag([[2000, 0]]);
    expect(model.$bpm.value).toBe(240);
    drag([[0, 2000]]);
    expect(model.$bpm.value).toBe(30);
  });

  it('takes no drag nor typing from a press on its carets', () => {
    const { transport, display, field } = setup();
    const faster = screen.getByRole('button', { name: 'Faster' });
    pointer('pointerdown', faster, [100, 100]);
    expect(display()).not.toHaveClass('active');
    pointer('pointermove', document, [100, 60]);
    pointer('pointerup', document, [0, 0]);
    expect(transport[0].$bpm.value).toBe(120);
    fireEvent.doubleClick(faster);
    expect(field()).toBeNull();
  });

  it('types the tempo on a double click: Enter or a click elsewhere takes it, Escape does not', () => {
    const { transport, shown, display, field } = setup();
    const [model] = transport;
    fireEvent.doubleClick(display());
    expect(field()?.value).toBe('120');
    // the value as it was blinks until the first key replaces it
    expect(display()).toHaveClass('typing');
    expect(display()).toHaveClass('fresh');
    fireEvent.change(field() as HTMLInputElement, { target: { value: '93,5' } });
    expect(field()?.value).toBe('93.5');
    expect(display()).not.toHaveClass('fresh');
    // the cells where its digits stand
    expect(shown()).toBe('93.5');
    expect(model.$bpm.value).toBe(120);
    fireEvent.keyDown(field() as HTMLInputElement, { key: 'Enter' });
    expect(model.$bpm.value).toBe(93.5);
    expect(field()).toBeNull();
    expect(shown()).toBe('93.50');

    fireEvent.doubleClick(display());
    fireEvent.change(field() as HTMLInputElement, { target: { value: '20' } });
    fireEvent.blur(field() as HTMLInputElement);
    expect(model.$bpm.value).toBe(30);

    fireEvent.doubleClick(display());
    fireEvent.change(field() as HTMLInputElement, { target: { value: '60' } });
    fireEvent.keyDown(field() as HTMLInputElement, { key: 'Escape' });
    expect(field()).toBeNull();
    expect(model.$bpm.value).toBe(30);

    fireEvent.doubleClick(display());
    fireEvent.change(field() as HTMLInputElement, { target: { value: '' } });
    fireEvent.keyDown(field() as HTMLInputElement, { key: 'Enter' });
    expect(model.$bpm.value).toBe(30);
  });

  it('a caret pressed while typing takes what is typed, then steps from it', () => {
    const { transport, shown, display, field } = setup();
    const [model] = transport;
    fireEvent.doubleClick(display());
    fireEvent.change(field() as HTMLInputElement, { target: { value: '128' } });
    // the caret keeps the focus in the field: no blur takes it
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Faster' }));
    fireEvent.click(screen.getByRole('button', { name: 'Faster' }));
    expect(field()).toBeNull();
    expect(model.$bpm.value).toBe(129);
    expect(shown()).toBe('129.00');

    // nothing to take: a step from the tempo as it is
    fireEvent.doubleClick(display());
    fireEvent.change(field() as HTMLInputElement, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Slower' }), { shiftKey: true });
    expect(field()).toBeNull();
    expect(model.$bpm.value).toBe(128.99);
  });

  it('takes only what the display has room for: 3 digits, a point, 2 decimals', () => {
    const { display, field } = setup();
    fireEvent.doubleClick(display());
    for (const value of ['1234', '12.345', 'fast', '1-2'])
      fireEvent.change(field() as HTMLInputElement, { target: { value } });
    expect(field()?.value).toBe('120');
    fireEvent.change(field() as HTMLInputElement, { target: { value: '199.99' } });
    expect(field()?.value).toBe('199.99');
  });

  it('keeps the keys it is typed with from the notes', () => {
    const { display, field } = setup();
    const keys = jest.fn();
    window.addEventListener('keydown', keys);
    fireEvent.doubleClick(display());
    fireEvent.keyDown(field() as HTMLInputElement, { key: 'a' });
    window.removeEventListener('keydown', keys);
    expect(keys).not.toHaveBeenCalled();
  });

  it('shows the tempo of a MIDI Clock as EXT, to 0.1, only shown', () => {
    const { transport, shown, display, field, drag } = setup();
    const [model, actions] = transport;
    act(() => {
      actions.setSource('midi');
      actions.follow({ time: 0, beat: 0, bpm: 109.94 });
    });
    expect(shown()).toBe('109.90');
    expect(screen.getByText('EXT')).toBeInTheDocument();
    expect(display()).not.toHaveClass('editable');
    expect(screen.queryByRole('button', { name: 'Faster' })).toBeNull();
    fireEvent.doubleClick(display());
    expect(field()).toBeNull();
    drag([[0, -40]]);
    expect(model.$bpm.value).toBe(120);
    // the clock lost: the field's own again
    act(() => actions.setSource('internal'));
    expect(shown()).toBe('120.00');
    expect(screen.getByText('BPM')).toBeInTheDocument();
  });
});
