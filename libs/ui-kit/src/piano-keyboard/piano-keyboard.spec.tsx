import React from 'react';
import { render, screen } from '@testing-library/react';
import { PianoKeyboard } from './index';

// jsdom has no PointerEvent: a mouse event with a pointer id, React reads both alike
const pointer = (type: string, target: EventTarget, init: MouseEventInit = {}) =>
  target.dispatchEvent(
    Object.assign(new MouseEvent(type, { bubbles: true, button: 0, clientX: 1, clientY: 1, ...init }), {
      pointerId: 1,
    })
  );

// a keyboard of octaves 3 and 4, `pointAt` puts the point on a key (jsdom has no layout), no pointer is captured
const setup = () => {
  const onPress = jest.fn();
  const onRelease = jest.fn();
  const { container } = render(
    <PianoKeyboard pressed={{}} octaves={[3, 4]} fitScreen={false} onPress={onPress} onRelease={onRelease} />
  );
  const key = (octave: number, note: string) =>
    container.querySelector(`[data-octave="${octave}"][data-note="${note}"]`) as HTMLElement;
  const pointAt = (element: HTMLElement) => Object.assign(document, { elementFromPoint: () => element });
  Object.assign(Element.prototype, { hasPointerCapture: () => false });
  return { onPress, onRelease, key, pointAt };
};

afterEach(() => {
  Reflect.deleteProperty(document, 'elementFromPoint');
  Reflect.deleteProperty(Element.prototype, 'hasPointerCapture');
});

describe('PianoKeyboard', () => {
  it('labels the C key of every octave', () => {
    const { container } = render(<PianoKeyboard pressed={{}} octaves={[2, 4]} fitScreen={false} />);
    ['C2', 'C3', 'C4'].forEach((label) => expect(screen.getByText(label)).toBeTruthy());
    expect(screen.queryByText('C1')).toBeNull();
    expect(screen.queryByText('C5')).toBeNull();
    expect(container.querySelector('[data-octave="3"][data-note="C"]')?.textContent).toBe('C3');
    expect(container.querySelector('[data-octave="3"][data-note="D"]')?.textContent).toBe('');
  });

  it('a pointer on a key presses its note in the pointerdown event, the pointerup releases it', () => {
    const { onPress, onRelease, key, pointAt } = setup();
    pointAt(key(3, 'E'));
    pointer('pointerdown', key(3, 'E'));
    expect(onPress).toHaveBeenCalledWith([3, 'E']);
    expect(onRelease).not.toHaveBeenCalled();
    pointer('pointerup', document);
    expect(onRelease).toHaveBeenCalledWith([3, 'E']);
  });

  it('a pointer with its button pressed slides onto the key under it', () => {
    const { onPress, onRelease, key, pointAt } = setup();
    pointAt(key(3, 'E'));
    pointer('pointerdown', key(3, 'E'));
    pointAt(key(3, 'F'));
    pointer('pointermove', document, { buttons: 1 });
    expect(onRelease).toHaveBeenCalledWith([3, 'E']);
    expect(onPress).toHaveBeenLastCalledWith([3, 'F']);
  });

  it('a pointer that moves without a button lost its pointerup: it releases its key and plays no other', () => {
    const { onPress, onRelease, key, pointAt } = setup();
    pointAt(key(3, 'E'));
    pointer('pointerdown', key(3, 'E'));
    pointAt(key(3, 'F'));
    pointer('pointermove', document, { buttons: 0 });
    expect(onRelease).toHaveBeenCalledWith([3, 'E']);
    pointer('pointermove', document, { buttons: 0 });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('releases the held keys when the window loses focus', () => {
    const { onPress, onRelease, key, pointAt } = setup();
    pointAt(key(3, 'E'));
    pointer('pointerdown', key(3, 'E'));
    window.dispatchEvent(new Event('blur'));
    expect(onRelease).toHaveBeenCalledWith([3, 'E']);
    // a move after that plays nothing
    pointer('pointermove', document, { buttons: 1 });
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
