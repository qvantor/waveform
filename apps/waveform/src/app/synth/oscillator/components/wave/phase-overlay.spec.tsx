import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { theme } from '@waveform/ui-kit';
import { drawn, svgPath, withElementSize } from '@waveform/ui-kit/test-utils';
import { createOscillator } from '../../../../../test-utils/models';
import { OscillatorContext } from '../../hooks';
import { Chart } from './chart';
import { PHASE_FADE } from './phase-overlay';

// the chart pads x by -1 and y by 2: the wave spans 400 × 100
const [WIDTH, HEIGHT] = [400, 100];

// the wave on the canvas of the chart (its stroke)
const waveLine = () =>
  svgPath(drawn(screen.getByTestId('wave-line')).find(({ op }) => op === 'stroke') ?? { points: [] });

const setup = (phaseVisible = true) => {
  const oscillator = createOscillator();
  const [, actions] = oscillator;
  const chart = (visible: boolean) => (
    <OscillatorContext.Provider value={oscillator}>
      <Chart phaseVisible={visible} />
    </OscillatorContext.Provider>
  );
  const result = render(chart(phaseVisible));
  const set = (phase: number, phaseRand: number) =>
    act(() => {
      actions.setOscValue('phase', phase);
      actions.setOscValue('phaseRand', phaseRand);
    });
  const attr = (testId: string, name: string) => Number(screen.getByTestId(testId).getAttribute(name));
  // the point on the wave: the dot painted on the canvas of the overlay
  const dot = () => {
    const [{ x, y }] =
      drawn(screen.getByTestId('phase-wave')).find(({ arcs }) => arcs.length > 0)?.arcs ?? [];
    return { x, y };
  };
  const bands = () =>
    screen
      .queryAllByTestId('phase-band')
      .map((band) => [Number(band.getAttribute('x')), Number(band.getAttribute('width'))]);
  return {
    ...result,
    set,
    attr,
    dot,
    bands,
    rerender: (visible: boolean) => result.rerender(chart(visible)),
  };
};

describe('Chart of the wave', () => {
  let restore: () => void;
  beforeEach(() => {
    restore = withElementSize(WIDTH - 2, HEIGHT + 4);
  });
  afterEach(() => {
    restore();
    jest.useRealTimers();
  });

  it('draws one period of the placeholder from edge to edge, its first sample again at the end', () => {
    setup(false);
    expect(waveLine()).toContain('L0,50L100,0L200,50L300,100L400,50');
  });

  it('shows nothing over the wave while Phase and Phase rand are not dragged', () => {
    setup(false);
    expect(screen.queryByTestId('phase-overlay')).toBeNull();
  });

  it('marks the phase on the wave: a line at its share of the width, a point on the wave', () => {
    const { set, attr, dot } = setup();
    set(0.25, 0);
    expect(attr('phase-marker', 'x1')).toBe(WIDTH / 4);
    // at the crest of the placeholder sine [0, 1, 0, -1]
    expect(dot()).toEqual({ x: WIDTH / 4, y: 0 });
  });

  it('puts the point between two samples on the line between them, past the last one towards the first', () => {
    const { set, dot } = setup();
    set(0.125, 0);
    expect(dot().y).toBe(HEIGHT / 4);
    set(0.9, 0);
    expect(dot().x).toBeCloseTo(WIDTH * 0.9, 10);
    expect(dot().y).toBeCloseTo(HEIGHT * 0.7, 10);
  });

  it('has no band at Phase rand 0: every voice starts at the phase', () => {
    const { set, bands } = setup();
    set(0.25, 0);
    expect(bands()).toEqual([]);
    expect(screen.queryByTestId('phase-band-end')).toBeNull();
  });

  it('spreads the starts over the band from the phase by Phase rand, its end dashed', () => {
    const { set, bands, attr } = setup();
    set(0.25, 0.5);
    expect(bands()).toEqual([[WIDTH / 4, WIDTH / 2]]);
    expect(attr('phase-band-end', 'x1')).toBe((WIDTH * 3) / 4);
  });

  it('wraps the band past the end of the period to its start, as the voices do', () => {
    const { set, bands, attr } = setup();
    set(0.75, 0.5);
    expect(bands()).toEqual([
      [(WIDTH * 3) / 4, WIDTH / 4],
      [0, WIDTH / 4],
    ]);
    expect(attr('phase-band-end', 'x1')).toBe(WIDTH / 4);
    expect(attr('phase-marker', 'x1')).toBe((WIDTH * 3) / 4);
  });

  it('highlights the wave inside the band: the line clipped by its rects', () => {
    const { set } = setup();
    set(0.75, 0.5);
    const [highlight] = drawn(screen.getByTestId('phase-wave'));
    // the wave drawn
    expect([highlight.op, highlight.style, highlight.lineWidth]).toEqual([
      'stroke',
      theme.colors.secondAccent,
      2,
    ]);
    expect(svgPath(highlight)).toContain('L0,50L100,0L200,50L300,100L400,50');
    expect(highlight.clip?.map(([x, , width]) => [x, width])).toEqual([
      [(WIDTH * 3) / 4, WIDTH / 4],
      [0, WIDTH / 4],
    ]);
  });

  it('covers the whole wave at Phase rand 100%: any phase', () => {
    const { set, bands } = setup();
    set(0, 1);
    expect(bands()).toEqual([[0, WIDTH]]);
    expect(screen.queryByTestId('phase-band-end')).toBeNull();
  });

  it('fades out once let go, then is not rendered', () => {
    jest.useFakeTimers();
    const { rerender } = setup();
    expect(screen.getByTestId('phase-overlay').style.opacity).toBe('1');
    rerender(false);
    expect(screen.getByTestId('phase-overlay').style.opacity).toBe('0');
    act(() => {
      jest.advanceTimersByTime(PHASE_FADE - 1);
    });
    expect(screen.getByTestId('phase-overlay')).toBeDefined();
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId('phase-overlay')).toBeNull();
  });

  it('shows again when dragged during the fade', () => {
    jest.useFakeTimers();
    const { rerender } = setup();
    rerender(false);
    rerender(true);
    act(() => {
      jest.advanceTimersByTime(PHASE_FADE);
    });
    expect(screen.getByTestId('phase-overlay').style.opacity).toBe('1');
  });

  it('draws the wave where the routes of the Wave knob move the position: the frame it plays, the point on it', () => {
    const oscillator = createOscillator();
    const [{ $position }, actions] = oscillator;
    act(() =>
      actions.setWaveTable([
        [0, 1, 0, -1],
        [0, 0.5, 0, -0.5],
        [0, 0, 0, 0],
      ])
    );
    const route = { id: 'env2', color: '#fff', amount: 1, level: () => 0.5, live: true };
    const chart = (modulations?: typeof route[]) => (
      <OscillatorContext.Provider value={oscillator}>
        <Chart phaseVisible modulations={modulations} />
      </OscillatorContext.Provider>
    );
    act(() => actions.setOscValue('phase', 0.25));
    // half the travel of 3 frames: from frame 0 to frame 1 (one frame, never a mix), the crest at 0.5
    const live = render(chart([route]));
    const moved = waveLine();
    expect(moved).toContain('L0,50L100,25L200,50L300,75L400,50');
    const [dot] = drawn(screen.getByTestId('phase-wave')).flatMap(({ arcs }) => arcs);
    expect(dot.y).toBe(25);
    live.unmount();
    act(() => $position.next(1));
    render(chart());
    expect(waveLine()).toBe(moved);
  });
});
