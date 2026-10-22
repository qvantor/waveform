import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { ValueTooltip } from './value-tooltip';
import { NARROW_ATTR, Tooltip } from './index';

// px: the viewport, the knob, the tooltip on one line and stacked
const VIEWPORT = 400;
const KNOB = 50;
const WIDE = 140;

// jsdom has no PointerEvent: a mouse event with the pointer type name and a pointerId works for the listeners of
// the tooltip and the document listeners of the pointer tracker
const pointer = (type: string, target: EventTarget) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  act(() => {
    target.dispatchEvent(event);
  });
};

// jsdom lays nothing out: the knob at left, the tooltip as wide as its layout
const layout = (left: number, stacked: number) => {
  jest.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left,
    width: KNOB,
    top: 0,
    height: KNOB,
  } as DOMRect);
  jest.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute(NARROW_ATTR) ? stacked : WIDE;
  });
};

const show = () => {
  render(
    <Tooltip content={<ValueTooltip name='Early reflections'>50%</ValueTooltip>}>
      <div data-testid='knob' />
    </Tooltip>
  );
  pointer('pointerdown', screen.getByTestId('knob'));
};

// the tooltip shown: stacked, moved by px
const inner = () => document.getElementById('tooltip')?.firstElementChild?.firstElementChild as HTMLElement;
const narrow = () => inner().hasAttribute(NARROW_ATTR);
const shift = () => inner().style.marginLeft;

describe('Tooltip', () => {
  beforeAll(() => {
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: VIEWPORT });
  });
  afterAll(() => Reflect.deleteProperty(document.documentElement, 'clientWidth'));
  afterEach(() => {
    pointer('pointerup', document);
    jest.restoreAllMocks();
  });

  it('stays on one line where it fits the viewport', () => {
    layout((VIEWPORT - KNOB) / 2, 60);
    show();
    expect(inner().textContent).toBe('Early reflections50%');
    expect(narrow()).toBe(false);
    expect(shift()).toBe('');
  });

  it('stacks the name over the value at an edge of the viewport', () => {
    layout(0, 40);
    show();
    expect(narrow()).toBe(true);
    // stacked it fits: centered on the knob
    expect(shift()).toBe('0px');
  });

  it('moves inside the viewport, 4 px from its edge, what still does not fit stacked', () => {
    // 60 px around the middle of the knob at 25 px: 5 px out of the viewport
    layout(0, 60);
    show();
    expect(narrow()).toBe(true);
    expect(shift()).toBe('9px');
  });

  it('moves inside the viewport from its right edge too', () => {
    layout(VIEWPORT - KNOB, 60);
    show();
    expect(shift()).toBe('-9px');
  });

  it('lays out again for a new text only, not on every render (a knob dragged renders with every move)', () => {
    layout((VIEWPORT - KNOB) / 2, 60);
    const tooltip = (value: string) => (
      <Tooltip content={<ValueTooltip name='Early reflections'>{value}</ValueTooltip>}>
        <div data-testid='knob' />
      </Tooltip>
    );
    const { rerender } = render(tooltip('50%'));
    pointer('pointerdown', screen.getByTestId('knob'));
    const measured = () => jest.mocked(Element.prototype.getBoundingClientRect).mock.calls.length;
    const shown = measured();
    rerender(tooltip('50%'));
    expect(measured()).toBe(shown);
    rerender(tooltip('51%'));
    expect(measured()).toBeGreaterThan(shown);
  });

  it('is on one line again once shown where it fits', () => {
    layout(0, 40);
    show();
    expect(narrow()).toBe(true);
    pointer('pointerup', document);
    layout((VIEWPORT - KNOB) / 2, 40);
    pointer('pointerdown', screen.getByTestId('knob'));
    expect(narrow()).toBe(false);
  });
});
