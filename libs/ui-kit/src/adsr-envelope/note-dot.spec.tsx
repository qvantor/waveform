import React from 'react';
import { render } from '@testing-library/react';
import { scaleLinear } from 'd3-scale';
import { line } from 'd3-shape';
import { LineChartContext } from '../line-chart/constants';
import { dotKeyframes, NotePath, NoteDot } from './note-dot';

// a chart of 0..2 s × 0..1 on 200 × 100 pixels (the level up), padding 10, 5
const scaleX = scaleLinear([0, 200]).domain([0, 2]);
const scaleY = scaleLinear([0, 100]).domain([1, 0]);
const context = {
  width: 220,
  height: 110,
  padding: [10, 5] as [number, number],
  scaleX,
  scaleY,
  lineFn: line<number>(),
  ref: React.createRef<HTMLDivElement>(),
};

const held: NotePath = {
  start: 1000,
  corners: [
    [0, 0, 0],
    [0.5, 0.5, 1],
    [1, 1, 0.5],
  ],
  held: true,
};

describe('dotKeyframes', () => {
  it('each corner at its pixel at its share of the path', () => {
    expect(dotKeyframes(held, scaleX, scaleY, [10, 5])).toEqual({
      duration: 1000,
      keyframes: [
        { offset: 0, transform: 'translate(10px, 105px)', opacity: 1 },
        { offset: 0.5, transform: 'translate(60px, 5px)', opacity: 1 },
        { offset: 1, transform: 'translate(110px, 55px)', opacity: 1 },
      ],
    });
  });

  it('a step: two keyframes at the same offset', () => {
    const path: NotePath = {
      ...held,
      corners: [
        [0, 0, 0],
        [0.5, 0.5, 0.5],
        [0.5, 1, 0.5],
        [1.5, 2, 0],
      ],
    };
    const { keyframes } = dotKeyframes(path, scaleX, scaleY, [0, 0]);
    expect(keyframes.map(({ offset }) => offset)).toEqual([0, 1 / 3, 1 / 3, 1]);
  });

  it('a path of 0 s ends on its last corner', () => {
    const path: NotePath = {
      ...held,
      corners: [
        [0, 0, 0],
        [0, 0, 1],
        [0, 0, 0.5],
      ],
    };
    const { keyframes, duration } = dotKeyframes(path, scaleX, scaleY, [0, 0]);
    expect(duration).toBe(0);
    expect(keyframes.map(({ offset }) => offset)).toEqual([0, 0, 1]);
    expect(keyframes[2]).toMatchObject({ transform: 'translate(0px, 50px)' });
  });
});

describe('NoteDot', () => {
  const animations: { startTime: number | null; cancel: jest.Mock }[] = [];
  const animate = jest.fn(() => {
    const animation = { startTime: null, cancel: jest.fn() };
    animations.push(animation);
    return animation;
  });

  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'animate', { value: animate, configurable: true });
    // 0.5 s after the start of the paths
    jest.spyOn(performance, 'now').mockReturnValue(1500);
  });
  afterEach(() => {
    Reflect.deleteProperty(HTMLElement.prototype, 'animate');
    jest.restoreAllMocks();
    animate.mockClear();
    animations.length = 0;
  });

  // released at 1 s, its release over `end` s after the start
  const releasedTill = (end: number): NotePath => ({
    ...held,
    corners: [...held.corners, [end, end, 0]],
    held: false,
  });

  const renderDot = (path: NotePath | null) => (
    <LineChartContext.Provider value={context}>
      <NoteDot path={path} />
    </LineChartContext.Provider>
  );

  it('animates the dot along the path from the start of the note: held, it stays on the sustain', () => {
    render(renderDot(held));
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate).toHaveBeenCalledWith(dotKeyframes(held, scaleX, scaleY, [10, 5]).keyframes, {
      duration: 1000,
      fill: 'forwards',
    });
    expect(animations[0].startTime).toBe(1000);
  });

  it('a new path replaces the animation; released, the dot is hidden after it', () => {
    const { rerender } = render(renderDot(held));
    const released: NotePath = { ...held, corners: [...held.corners, [2, 2, 0]], held: false };
    rerender(renderDot(released));
    expect(animations[0].cancel).toHaveBeenCalled();
    expect(animate).toHaveBeenLastCalledWith(expect.any(Array), { duration: 2000, fill: 'none' });
    expect(animations[1].startTime).toBe(1000);

    rerender(renderDot(null));
    expect(animations[1].cancel).toHaveBeenCalled();
    expect(animate).toHaveBeenCalledTimes(2);
  });

  it('the same path is not animated again on a render', () => {
    const { rerender } = render(renderDot(held));
    rerender(renderDot(held));
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it('a released path whose release is over is not animated (it would be hidden at once), a held one is', () => {
    const released: NotePath = { ...held, corners: [...held.corners, [2, 2, 0]], held: false };
    jest.spyOn(performance, 'now').mockReturnValue(3000);
    const { rerender } = render(renderDot(released));
    expect(animate).not.toHaveBeenCalled();
    rerender(renderDot({ ...held }));
    expect(animate).toHaveBeenCalledTimes(1);
  });

  // a knob turned while the dot is on the release line moves it, after it its note is over
  it('a longer release brings the dot back only before its release is over', () => {
    const { rerender } = render(renderDot(releasedTill(2)));
    expect(animate).toHaveBeenCalledTimes(1);
    rerender(renderDot(releasedTill(3)));
    expect(animate).toHaveBeenCalledTimes(2);
    // hidden at 4000
    jest.spyOn(performance, 'now').mockReturnValue(4500);
    rerender(renderDot(releasedTill(10)));
    expect(animate).toHaveBeenCalledTimes(2);
    // another note
    rerender(renderDot({ ...releasedTill(10), start: 4000 }));
    expect(animate).toHaveBeenCalledTimes(3);
  });

  it('a note over when the dot is made stays over with a longer release', () => {
    jest.spyOn(performance, 'now').mockReturnValue(3500);
    const { rerender } = render(renderDot(releasedTill(2)));
    rerender(renderDot(releasedTill(10)));
    expect(animate).not.toHaveBeenCalled();
  });
});
