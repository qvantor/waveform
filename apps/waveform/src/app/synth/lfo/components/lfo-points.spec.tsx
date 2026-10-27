import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { LineChart } from '@waveform/ui-kit';
import { withElementSize } from '@waveform/ui-kit/test-utils';
import { LFO_POINTS_MAX, LfoPoint } from '@waveform/preset-schema';
import { LFO_TABLE_SIZE, lfoTable } from '../../common/lfo/lfo-curve';
import { LFO_SHAPE_OPTIONS } from '../lfo-shapes';
import { LfoPoints } from './lfo-points';

// a line up to 1 at the middle of the cycle, down to 0 at its end
const triangle: LfoPoint[] = [
  [0, 0, 0],
  [0.5, 1, 0],
];
const three: LfoPoint[] = [
  [0, 0, 0],
  [0.3, 1, 0],
  [0.6, 0, 0],
];
const gate16 = LFO_SHAPE_OPTIONS.flatMap((option) =>
  'points' in option && option.id === 'gate-16' ? option.points : []
);

// the line of the chart: every 8th level of the table of the points
const lineOf = (points: LfoPoint[]) => {
  const table = lfoTable('sine', points);
  return Array.from({ length: 257 }, (_, i): [number, number] => [
    i / 256,
    table[(i * LFO_TABLE_SIZE) / 256],
  ]);
};

// jsdom has no PointerEvent: a mouse event with the pointer type name and a pointerId works for React and the
// document listeners of the drag; the plot is at 0, 0 (no layout), so px are client coordinates
const pointer = (type: string, target: EventTarget, [clientX, clientY]: [number, number]) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0 });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  act(() => {
    target.dispatchEvent(event);
  });
};

const setup = (points: LfoPoint[] = triangle) => {
  const onChange = jest.fn();
  const element = (points: LfoPoint[]) => (
    // a chart of 300 × 60 with the padding of the LFO chart: the cycle over 300 px, the levels over 52 (up)
    <LineChart domainX={[0, 1]} domainY={[1, 0]} padding={[0, 4]}>
      <LfoPoints points={points} line={lineOf(points)} onChange={onChange} />
    </LineChart>
  );
  const result = render(element(points));
  const point = (n: number) => screen.getByRole('button', { name: `Point ${n}` });
  const handle = (n: number) => screen.getByRole('slider', { name: `Segment ${n} curve` });
  const area = () => screen.getByTestId('lfo-area');
  const ghost = () => {
    const ghost = screen.queryByTestId('lfo-ghost');
    return ghost && [Number(ghost.getAttribute('cx')), Number(ghost.getAttribute('cy'))];
  };
  // presses the element at `from` and drags by each [dx, dy] in turn, then lets go
  const drag = (target: Element, from: [number, number], ...moves: [number, number][]) => {
    pointer('pointerdown', target, from);
    moves.forEach(([dx, dy]) => pointer('pointermove', document, [from[0] + dx, from[1] + dy]));
    pointer('pointerup', document, from);
  };
  return {
    onChange,
    point,
    handle,
    area,
    ghost,
    drag,
    rerender: (points: LfoPoint[]) => result.rerender(element(points)),
  };
};

const names = (role: string) =>
  screen.queryAllByRole(role).map((element) => element.getAttribute('aria-label'));

describe('LfoPoints', () => {
  let restoreSize: () => void;
  beforeEach(() => (restoreSize = withElementSize(300, 60)));
  afterEach(() => restoreSize());

  it('shows the points where they are', () => {
    const { point } = setup();
    expect(names('button')).toEqual(['Point 1', 'Point 2']);
    expect(point(1).getAttribute('transform')).toBe('translate(0, 52)');
    expect(point(2).getAttribute('transform')).toBe('translate(150, 0)');
  });

  it('a point dragged follows the pointer from where it was pressed, the first one along the levels only', () => {
    const { point, drag, onChange } = setup();
    // a press alone moves nothing
    drag(point(2), [152, 1]);
    expect(onChange).not.toHaveBeenCalled();
    drag(point(2), [152, 1], [30, 13]);
    expect(onChange).toHaveBeenLastCalledWith([
      [0, 0, 0],
      [0.6, 0.75, 0],
    ]);
    drag(point(1), [0, 52], [30, -26]);
    expect(onChange).toHaveBeenLastCalledWith([
      [0, 0.5, 0],
      [0.5, 1, 0],
    ]);
  });

  it('stops at its neighbours: onto one it makes a step', () => {
    const { point, drag, onChange } = setup(three);
    drag(point(2), [90, 0], [150, 0]);
    expect(onChange).toHaveBeenLastCalledWith([three[0], [0.6, 1, 0], three[2]]);
    expect(point(2).classList.contains('active')).toBe(false);
  });

  it('has the point of the curve of each segment that rises or falls, the last one to the start of the cycle too', () => {
    const { handle, drag, onChange, rerender } = setup();
    expect(names('slider')).toEqual(['Segment 1 curve', 'Segment 2 curve']);
    expect(handle(2).getAttribute('transform')).toBe('translate(225, 26)');
    // up a quarter of the rise: 75% of it done at its middle
    drag(handle(1), [75, 26], [0, -13]);
    expect(onChange).toHaveBeenLastCalledWith([
      [0, 0, 2.2],
      [0.5, 1, 0],
    ]);
    // a square: flat segments and a step
    rerender([
      [0, 1, 0],
      [0.5, 1, 0],
      [0.5, 0, 0],
      [1, 0, 0],
    ]);
    expect(names('slider')).toEqual([]);
  });

  it('shows where a press adds a point: within 6 px of the line, away from the points, not at the most', () => {
    const { area, ghost, rerender } = setup();
    pointer('pointermove', area(), [75, 26]);
    expect(ghost()).toEqual([75, 26]);
    expect(area().classList.contains('near')).toBe(true);
    pointer('pointermove', area(), [75, 40]);
    expect(ghost()).toBeNull();
    expect(area().classList.contains('near')).toBe(false);
    // on the line, within the hit area of the first point
    pointer('pointermove', area(), [6, 50]);
    expect(ghost()).toBeNull();
    pointer('pointermove', area(), [75, 26]);
    // (React hears a pointerleave as a pointerout)
    pointer('pointerout', area(), [75, 26]);
    expect(ghost()).toBeNull();
    rerender(gate16);
    expect(gate16).toHaveLength(LFO_POINTS_MAX);
    pointer('pointermove', area(), [1, 0]);
    expect(ghost()).toBeNull();
  });

  it('a press near the line adds a point there and drags it on', () => {
    const { area, drag, onChange } = setup();
    // on the line, a quarter into the cycle: the point there, the drag goes on from it
    drag(area(), [75, 26], [30, 0]);
    expect(onChange.mock.calls).toEqual([
      [
        [
          [0, 0, 0],
          [0.25, 0.5, 0],
          [0.5, 1, 0],
        ],
      ],
      [
        [
          [0, 0, 0],
          [0.35, 0.5, 0],
          [0.5, 1, 0],
        ],
      ],
    ]);
  });

  it('a press away from the line adds nothing', () => {
    const { area, drag, onChange } = setup();
    drag(area(), [75, 45], [30, 0]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a double click takes a point out, not the first one, none of two', () => {
    const { point, onChange, rerender } = setup(three);
    fireEvent.doubleClick(point(2));
    expect(onChange).toHaveBeenLastCalledWith([three[0], three[2]]);
    fireEvent.doubleClick(point(1));
    expect(onChange).toHaveBeenCalledTimes(1);
    rerender(triangle);
    fireEvent.doubleClick(point(2));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('shows no spot while a point is dragged', () => {
    const { point, area, ghost } = setup();
    pointer('pointerdown', point(2), [150, 0]);
    expect(point(2).classList.contains('active')).toBe(true);
    pointer('pointermove', area(), [75, 26]);
    expect(ghost()).toBeNull();
    pointer('pointerup', document, [150, 0]);
    pointer('pointermove', area(), [75, 26]);
    expect(ghost()).toEqual([75, 26]);
  });
});
