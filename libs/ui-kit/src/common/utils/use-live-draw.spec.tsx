import React from 'react';
import { act, render } from '@testing-library/react';
import { LiveKnob, MIN_FRAME_MS, useLiveDraw } from './use-live-draw';

interface Props {
  knobs: LiveKnob[];
  active?: boolean;
}

let level: number | null = 1;
let now = 0;
// the values of every drawing (the array of the hook is reused)
let drawings: number[][] = [];
const draw = (values: number[]) => drawings.push([...values]);

const Chart = ({ knobs, active }: Props) => {
  useLiveDraw(knobs, draw, active);
  return null;
};

const route = (amount: number, live = true) => ({ amount, level: () => level, live });
const knob = (amount: number, live = true): LiveKnob => ({
  value: 0.5,
  min: 0,
  max: 1,
  modulations: [route(amount, live)],
});
// a frame of the screen, `ms` after the last one
const tick = (ms = 16) =>
  act(() => {
    now += ms;
    jest.advanceTimersByTime(16);
  });

describe('useLiveDraw', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(performance, 'now').mockImplementation(() => now);
    level = 1;
    now = 1000;
    drawings = [];
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('draws the values of the knobs once while no route sounds: no frames', () => {
    render(<Chart knobs={[knob(0.25, false), { value: 3, min: 0, max: 10 }]} />);
    tick();
    level = 0.5;
    tick();
    expect(drawings).toEqual([[0.5, 3]]);
  });

  it('draws where the routes move the knobs, again only in a frame they moved in', () => {
    level = 0.5;
    render(<Chart knobs={[knob(0.5), { value: 3, min: 0, max: 10 }]} />);
    expect(drawings).toEqual([[0.75, 3]]);
    // a sustain
    tick();
    tick();
    expect(drawings).toHaveLength(1);
    level = 1;
    tick();
    expect(drawings.at(-1)).toEqual([1, 3]);
    // less than a step of the travel from the value: the value itself
    level = 0.0004;
    tick();
    expect(drawings.at(-1)).toEqual([0.5, 3]);
  });

  it('a log knob is moved in its scale, clamped to its travel', () => {
    const { rerender } = render(
      <Chart knobs={[{ value: 100, min: 10, max: 1000, mode: 'log', modulations: [route(0.25)] }]} />
    );
    // from the middle of the travel a quarter of it: 10 · 100^0.75
    expect(drawings[0][0]).toBeCloseTo(316.228, 3);
    rerender(<Chart knobs={[{ value: 100, min: 10, max: 1000, mode: 'log', modulations: [route(-2)] }]} />);
    expect(drawings.at(-1)?.[0]).toBeCloseTo(10, 9);
  });

  it('draws the values again once the routes stop sounding, inactive or without a level', () => {
    const { rerender } = render(<Chart knobs={[knob(0.25)]} />);
    expect(drawings).toEqual([[0.75]]);
    rerender(<Chart knobs={[knob(0.25, false)]} />);
    expect(drawings.at(-1)).toEqual([0.5]);
    rerender(<Chart knobs={[knob(0.25)]} active={false} />);
    expect(drawings.at(-1)).toEqual([0.5]);
    rerender(<Chart knobs={[knob(0.25)]} />);
    expect(drawings.at(-1)).toEqual([0.75]);
    level = null;
    tick();
    expect(drawings.at(-1)).toEqual([0.5]);
  });

  it(`draws at most every ${MIN_FRAME_MS} ms: every other frame of a 120 Hz screen`, () => {
    level = 0;
    render(<Chart knobs={[knob(0.5)]} />);
    const frame = (value: number) => {
      level = value;
      tick(1000 / 120);
      return drawings.length;
    };
    expect([0.1, 0.2, 0.3, 0.4].map(frame)).toEqual([1, 2, 2, 3]);
    expect(drawings.at(-1)).toEqual([0.7]);
  });
});
