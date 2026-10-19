import React from 'react';
import { render, screen } from '@testing-library/react';
import { PianoKeyboard } from './index';

// jsdom has no PointerEvent: a mouse event with a pointer id, React reads both alike
const pointer = (type: string, target: EventTarget) =>
  target.dispatchEvent(
    Object.assign(new MouseEvent(type, { bubbles: true, button: 0, clientX: 1, clientY: 1 }), {
      pointerId: 1,
    })
  );

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
    const onPress = jest.fn();
    const onRelease = jest.fn();
    const { container } = render(
      <PianoKeyboard
        pressed={{}}
        octaves={[3, 4]}
        fitScreen={false}
        onPress={onPress}
        onRelease={onRelease}
      />
    );
    const key = container.querySelector('[data-octave="3"][data-note="E"]') as HTMLElement;
    // jsdom has no layout: the point is on that key, no pointer is captured
    Object.assign(document, { elementFromPoint: () => key });
    Object.assign(Element.prototype, { hasPointerCapture: () => false });
    pointer('pointerdown', key);
    expect(onPress).toHaveBeenCalledWith([3, 'E']);
    expect(onRelease).not.toHaveBeenCalled();
    pointer('pointerup', document);
    expect(onRelease).toHaveBeenCalledWith([3, 'E']);
  });
});
