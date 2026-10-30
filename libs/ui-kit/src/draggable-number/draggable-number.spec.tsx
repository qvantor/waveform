import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { DraggableNumber } from './index';

// jsdom has no PointerEvent: a mouse event with the pointer type name and a pointerId works for React and
// the document listeners of the pointer tracker
const pointer = (type: string, target: EventTarget, clientY: number) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY, button: 0 });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  act(() => {
    target.dispatchEvent(event);
  });
};

describe('DraggableNumber', () => {
  it('steps by a whole number every 10 px dragged up, within its range, with its carets', () => {
    const onChange = jest.fn();
    const { container } = render(
      <DraggableNumber value={4} range={[1, 12]} label='Poly' onChange={onChange} />
    );
    expect(screen.getByText('Poly')).toBeDefined();
    expect(container.querySelectorAll('.anticon')).toHaveLength(2);
    pointer('pointerdown', screen.getByText('Poly'), 100);
    pointer('pointermove', document, 79);
    expect(onChange).toHaveBeenLastCalledWith(6);
    pointer('pointermove', document, 300);
    expect(onChange).toHaveBeenLastCalledWith(1);
    pointer('pointerup', document, 300);
  });
});
