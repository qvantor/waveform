import React from 'react';
import { act, render } from '@testing-library/react';
import { sizedElements } from '../common/test-utils/element-size';
import { ELLIPSIS, MiddleEllipsis, middleEllipsis } from './index';

// a text fits up to `max` characters
const upTo = (max: number) => (candidate: string) => candidate.length <= max;

describe('middleEllipsis', () => {
  it('keeps a text that fits whole', () => {
    expect(middleEllipsis('White', upTo(5))).toBe('White');
  });

  it('cuts the middle: as many characters before the ellipsis as after it, one more before', () => {
    expect(middleEllipsis('Modular Scratch', upTo(10))).toBe(`Modul${ELLIPSIS}atch`);
    expect(middleEllipsis('Modular Scratch', upTo(9))).toBe(`Modu${ELLIPSIS}atch`);
    expect(middleEllipsis('Modular Scratch', upTo(14))).toBe(`Modular${ELLIPSIS}cratch`);
  });

  it('drops the spaces at the cut', () => {
    expect(middleEllipsis('Ab cdef gh', upTo(6))).toBe(`Ab${ELLIPSIS}gh`);
  });

  it('is the ellipsis alone where nothing more fits', () => {
    expect(middleEllipsis('Modular Scratch', upTo(1))).toBe(ELLIPSIS);
    expect(middleEllipsis('Modular Scratch', upTo(0))).toBe(ELLIPSIS);
  });
});

describe('MiddleEllipsis', () => {
  // jsdom has no layout: 10 px a character, the element as wide as `room`
  let room = 60;
  let sized: ReturnType<typeof sizedElements>;
  let measured: jest.SpyInstance;
  beforeEach(() => {
    room = 60;
    sized = sizedElements(room, 20);
    measured = jest.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (
      this: HTMLElement
    ) {
      return (this.textContent?.length ?? 0) * 10;
    });
    jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => room);
  });
  afterEach(() => {
    sized.restore();
    jest.restoreAllMocks();
  });
  const resize = (width: number) => {
    room = width;
    act(() => sized.resize(width, 20));
  };

  it('shows the text cut in its middle where it does not fit, the whole of it in its title', () => {
    const { container, rerender } = render(<MiddleEllipsis text='Modular Scratch' />);
    const line = container.firstChild as HTMLElement;
    expect(line.textContent).toBe(`Mod${ELLIPSIS}ch`);
    expect(line.title).toBe('Modular Scratch');
    rerender(<MiddleEllipsis text='White' />);
    expect(line.textContent).toBe('White');
    expect(line.hasAttribute('title')).toBe(false);
  });

  it('cuts it again when its place changes', () => {
    const { container } = render(<MiddleEllipsis text='Modular Scratch' />);
    const line = container.firstChild as HTMLElement;
    resize(100);
    expect(line.textContent).toBe(`Modul${ELLIPSIS}atch`);
    resize(200);
    expect(line.textContent).toBe('Modular Scratch');
    expect(line.hasAttribute('title')).toBe(false);
  });

  it('measures nothing again for the place it was cut for', () => {
    render(<MiddleEllipsis text='Modular Scratch' />);
    const searched = measured.mock.calls.length;
    expect(searched).toBeGreaterThan(0);
    resize(60);
    expect(measured.mock.calls.length).toBe(searched);
  });
});
