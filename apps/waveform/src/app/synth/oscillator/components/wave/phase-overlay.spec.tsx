import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { createOscillator } from '../../../../../test-utils/models';
import { withElementSize } from '../../../../../test-utils/element-size';
import { OscillatorContext } from '../../hooks';
import { Chart } from './chart';
import { PHASE_FADE } from './phase-overlay';

// the chart pads x by -1 and y by 2: the wave spans 400 × 100
const [WIDTH, HEIGHT] = [400, 100];

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
  const bands = () =>
    screen
      .queryAllByTestId('phase-band')
      .map((band) => [Number(band.getAttribute('x')), Number(band.getAttribute('width'))]);
  return {
    ...result,
    set,
    attr,
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
    const { container } = setup(false);
    const line = container.querySelector('path')?.getAttribute('d');
    expect(line).toContain('L0,50L100,0L200,50L300,100L400,50');
  });

  it('shows nothing over the wave while Phase and Phase rand are not dragged', () => {
    setup(false);
    expect(screen.queryByTestId('phase-overlay')).toBeNull();
  });

  it('marks the phase on the wave: a line at its share of the width, a point on the wave', () => {
    const { set, attr } = setup();
    set(0.25, 0);
    expect(attr('phase-marker', 'x1')).toBe(WIDTH / 4);
    expect(attr('phase-dot', 'cx')).toBe(WIDTH / 4);
    // the crest of the placeholder sine [0, 1, 0, -1]
    expect(attr('phase-dot', 'cy')).toBe(0);
  });

  it('puts the point between two samples on the line between them, past the last one towards the first', () => {
    const { set, attr } = setup();
    set(0.125, 0);
    expect(attr('phase-dot', 'cy')).toBe(HEIGHT / 4);
    set(0.9, 0);
    expect(attr('phase-dot', 'cx')).toBeCloseTo(WIDTH * 0.9, 10);
    expect(attr('phase-dot', 'cy')).toBeCloseTo(HEIGHT * 0.7, 10);
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
    const overlay = screen.getByTestId('phase-overlay');
    const highlight = overlay.querySelector('g[clip-path]');
    const clip = highlight?.getAttribute('clip-path')?.match(/^url\(#(.+)\)$/)?.[1];
    expect(highlight?.querySelector('path')?.getAttribute('d')).toContain(
      'L0,50L100,0L200,50L300,100L400,50'
    );
    expect(overlay.querySelector(`clipPath[id="${clip}"]`)?.querySelectorAll('rect')).toHaveLength(2);
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
});
