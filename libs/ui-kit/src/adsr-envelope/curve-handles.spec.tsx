import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { scaleLinear } from 'd3-scale';
import { line } from 'd3-shape';
import { LineChartContext } from '../line-chart/constants';
import { CurveHandles, curveFromMidShare } from './curve-handles';
import { curveShape } from './envelope-line';

// a chart of 0..2 s × 0..1 on 200 × 100 pixels (the level up)
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

// the attack 0 → 1 over 0..0.5 s (100 px up), the decay 1 → 0.5 over 0.6..1 s and the release 0.5 → 0 over
// 1..1.5 s (50 px down each)
const stages = { attack: 0.5, hold: 0.1, decay: 0.4, sustain: 0.5, release: 0.5 };
const lines = { attack: 0, decay: 0, release: 0 };
const DEFAULTS = { attack: 0, decay: 3.49, release: 3.49 };

// jsdom has no PointerEvent: a mouse event with the pointer type name and a pointerId works for React and the
// document listeners of the pointer tracker
const pointer = (type: string, target: EventTarget, clientY: number) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 0, clientY, button: 0 });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  act(() => {
    target.dispatchEvent(event);
  });
};

const setup = (props: Partial<React.ComponentProps<typeof CurveHandles>> = {}) => {
  const onChange = jest.fn();
  const element = (extra: Partial<React.ComponentProps<typeof CurveHandles>>) => (
    <LineChartContext.Provider value={context}>
      <svg>
        <CurveHandles
          {...stages}
          curves={lines}
          max={10}
          defaults={DEFAULTS}
          onChange={onChange}
          {...extra}
        />
      </svg>
    </LineChartContext.Provider>
  );
  const result = render(element(props));
  const point = (name: string) => screen.getByRole('slider', { name: `${name} curve` });
  // presses the point and drags it down by each dy in turn (px, < 0 up), then lets it go
  const drag = (name: string, ...moves: number[]) => {
    pointer('pointerdown', point(name), 100);
    moves.forEach((dy) => pointer('pointermove', document, 100 + dy));
    pointer('pointerup', document, 100);
  };
  return { ...result, onChange, point, drag, rerender: (extra = props) => result.rerender(element(extra)) };
};

const names = () => screen.queryAllByRole('slider').map((point) => point.getAttribute('aria-label'));

describe('curveFromMidShare', () => {
  it('is the k of the share of a stage done at its middle', () => {
    [-10, -3.49, -0.5, 0.25, 3.49, 10].forEach((k) =>
      expect(curveFromMidShare(curveShape(k, 0.5))).toBeCloseTo(k, 9)
    );
    expect(curveFromMidShare(0.5)).toBe(0);
  });
});

describe('CurveHandles', () => {
  it('has a point on each stage that moves the level', () => {
    setup();
    expect(names()).toEqual(['Attack curve', 'Decay curve', 'Release curve']);
  });

  it('has none on a stage of 20 ms or less', () => {
    setup({ attack: 0.02, decay: 0.019, release: 0.021 });
    expect(names()).toEqual(['Release curve']);
  });

  it('has none on a flat stage: the decay to a sustain of 1, the release from a sustain of 0', () => {
    const { rerender } = setup({ sustain: 1 });
    expect(names()).toEqual(['Attack curve', 'Release curve']);
    rerender({ sustain: 0 });
    expect(names()).toEqual(['Attack curve', 'Decay curve']);
  });

  it('puts a point in the middle of its stage on its curve', () => {
    const { point } = setup({ curves: DEFAULTS });
    expect(point('Attack').getAttribute('transform')).toBe('translate(25, 50)');
    expect(point('Decay').getAttribute('transform')).toBe(
      `translate(80, ${scaleY(1 - 0.5 * curveShape(3.49, 0.5))})`
    );
    expect(point('Release').getAttribute('aria-valuenow')).toBe('3.49');
  });

  it('dragged up or down it follows the pointer: the share of the stage at its middle gives the k', () => {
    const { drag, onChange } = setup();
    // up a quarter of the attack: 75% of it done at its middle
    drag('Attack', -25);
    expect(onChange).toHaveBeenLastCalledWith('attack', 2.2);
    drag('Attack', 25);
    expect(onChange).toHaveBeenLastCalledWith('attack', -2.2);
    // down a fifth of the decay: 70% of it done, it falls fast at first
    drag('Decay', 10);
    expect(onChange).toHaveBeenLastCalledWith('decay', 1.69);
    drag('Release', -10);
    expect(onChange).toHaveBeenLastCalledWith('release', -1.69);
  });

  it('drags from the curve it had when pressed', () => {
    const { drag, onChange } = setup({ curves: { ...lines, attack: curveFromMidShare(0.75) } });
    drag('Attack', -10);
    expect(onChange).toHaveBeenLastCalledWith('attack', 3.47);
  });

  it('snaps to a line within 3 px of it', () => {
    // k 1: the middle of the decay is 6.1 px below the line
    const { drag, onChange } = setup({ curves: { ...lines, decay: 1 } });
    drag('Decay', -4);
    expect(onChange).toHaveBeenLastCalledWith('decay', 0);
  });

  it('stops at ±max', () => {
    const { drag, onChange } = setup();
    drag('Attack', -60);
    expect(onChange).toHaveBeenLastCalledWith('attack', 10);
    drag('Attack', 300);
    expect(onChange).toHaveBeenLastCalledWith('attack', -10);
  });

  it('calls onChange only when the k changes', () => {
    const { drag, onChange } = setup();
    // within the snap of the line, then past the top
    drag('Attack', -1, 2, -60, -61, -70);
    expect(onChange.mock.calls).toEqual([['attack', 10]]);
  });

  it('is active while a pointer holds it', () => {
    const { point } = setup();
    pointer('pointerdown', point('Decay'), 100);
    expect(point('Decay').classList.contains('active')).toBe(true);
    pointer('pointerup', document, 100);
    expect(point('Decay').classList.contains('active')).toBe(false);
  });

  it('a double click sets the default curve of its stage, a line without defaults', () => {
    const { point, onChange, rerender } = setup();
    fireEvent.doubleClick(point('Decay'));
    expect(onChange).toHaveBeenLastCalledWith('decay', 3.49);
    rerender({ curves: { ...lines, release: 4 }, defaults: undefined });
    fireEvent.doubleClick(point('Release'));
    expect(onChange).toHaveBeenLastCalledWith('release', 0);
  });

  it('the arrows move it up and down', () => {
    const { point, onChange } = setup();
    fireEvent.keyDown(point('Attack'), { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith('attack', 0.1);
    // up on a falling stage: less of it done at its middle
    fireEvent.keyDown(point('Decay'), { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith('decay', -0.1);
    fireEvent.keyDown(point('Release'), { key: 'ArrowDown' });
    expect(onChange).toHaveBeenLastCalledWith('release', 0.1);
  });
});
