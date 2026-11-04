import React from 'react';
import { BehaviorSubject } from 'rxjs';
import { act, render, screen } from '@testing-library/react';
import { HandleModulation, theme } from '@chisper/ui-kit';
import { drawn, withElementSize } from '@chisper/ui-kit/test-utils';
import { createOscillator } from '../../../../../test-utils/models';
import { UNISON_SHAPE, UnisonShape } from '../../../common/wavetable/voice-options';
import { OscillatorContext } from '../../hooks';
import { Chart } from './chart';
import { OVERLAY_FADE } from './fade-overlay';
import { unisonVoices } from './unison-voices';

// the chart pads x by -1 and y by 2: the wave spans 400 × 100, its middle at 200; the voices 6 px in from its edges
const [WIDTH, HEIGHT] = [400, 100];
const MIDDLE = WIDTH / 2;
const REACH = MIDDLE - 6;

const setup = (visible = true, detune?: HandleModulation[]) => {
  const oscillator = createOscillator();
  const [{ $unisonShape }, actions] = oscillator;
  const $visible = new BehaviorSubject(visible);
  const result = render(
    <OscillatorContext.Provider value={oscillator}>
      <Chart unison={{ $visible, detune }} />
    </OscillatorContext.Provider>
  );
  const set = (values: { unison?: number; detune?: number; blend?: number }) =>
    act(() =>
      Object.entries(values).forEach(([key, value]) =>
        actions.setOscValue(key as 'unison' | 'detune' | 'blend', value)
      )
    );
  // the fills of the voices: all but the veil
  const fills = () =>
    drawn(screen.getByTestId('unison-voices')).filter(
      ({ op, style }) => op === 'fill' && style !== theme.colors.primaryDark
    );
  // the bars of the voices from the left: their middle, their height (from the bottom), centre or not
  const bars = () =>
    fills()
      .map(({ rects: [[x, , width, height]], style }) => ({
        x: x + width / 2,
        height,
        center: style === theme.colors.accent,
      }))
      .sort((a, b) => a.x - b.x);
  const shape = (values: Partial<UnisonShape>) =>
    act(() => $unisonShape.next({ ...$unisonShape.value, ...values }));
  return { ...result, set, shape, fills, bars, show: (shown: boolean) => act(() => $visible.next(shown)) };
};

describe('the voices of the unison over the wave', () => {
  let restore: () => void;
  beforeEach(() => {
    restore = withElementSize(WIDTH - 2, HEIGHT + 4);
  });
  afterEach(() => {
    restore();
    jest.useRealTimers();
  });

  it('are not there while Detune, Blend and Unison are not held', () => {
    setup(false);
    expect(screen.queryByTestId('unison-overlay')).toBeNull();
  });

  it('veil the wave and show a bar per voice as high as its level: a unison of 2 is all centre', () => {
    const { bars } = setup();
    const [veil] = drawn(screen.getByTestId('unison-voices'));
    expect(veil).toMatchObject({ op: 'fill', style: theme.colors.primaryDark, alpha: 0.6 });
    // u2 at a detune of 5 cents: ±2.5 cents, each alone in its channel at the level of a voice of 2 (-1.9 dB)
    const offset = Math.sqrt(2.5 / 50) * REACH;
    expect(bars()).toEqual([
      { x: expect.closeTo(MIDDLE - offset, 6), height: expect.closeTo(0.8077 * HEIGHT, 6), center: true },
      { x: expect.closeTo(MIDDLE + offset, 6), height: expect.closeTo(0.8077 * HEIGHT, 6), center: true },
    ]);
  });

  it('draws only the bars, the centre ones green, the others blue and brighter', () => {
    const { set, fills } = setup();
    set({ unison: 3, detune: 50 });
    const voices = fills();
    // one fill per voice: no cap on top
    expect(voices.map(({ style }) => style).sort()).toEqual(
      [theme.colors.accent, theme.colors.secondAccent, theme.colors.secondAccent].sort()
    );
    const alpha = (style: string) => voices.find((fill) => fill.style === style)?.alpha ?? 0;
    expect(alpha(theme.colors.secondAccent)).toBeGreaterThan(alpha(theme.colors.accent));
  });

  it('puts each voice at its detune: on a square root of the cents, ±50 at the edges', () => {
    const { set, bars } = setup();
    set({ unison: 3, detune: 50 });
    expect(bars().map(({ x }) => x)).toEqual([
      expect.closeTo(MIDDLE - Math.sqrt(0.5) * REACH, 6),
      MIDDLE,
      expect.closeTo(MIDDLE + Math.sqrt(0.5) * REACH, 6),
    ]);
    set({ detune: 100 });
    expect(bars().map(({ x }) => x)).toEqual([MIDDLE - REACH, MIDDLE, MIDDLE + REACH]);
    // no spread: one voice
    set({ detune: 0 });
    expect(bars()).toEqual([{ x: MIDDLE, height: HEIGHT, center: true }]);
  });

  it('keeps every voice at no spread while a route raises it, as the voice plays them', () => {
    // ENV 2 on Detune, no note: the voices at the middle, each at its level
    const route = { id: 'env2', color: '#0f0', amount: 0.5 };
    const { set, bars } = setup(true, [route]);
    set({ unison: 3, detune: 0 });
    expect(bars().map(({ x }) => x)).toEqual([MIDDLE, MIDDLE, MIDDLE]);
    // switched off or lowering it: one voice
    setup(true, [{ ...route, off: true }]).set({ unison: 3, detune: 0 });
    setup(true, [{ ...route, amount: -0.5 }]).set({ unison: 3, detune: 0 });
    screen
      .getAllByTestId('unison-voices')
      .slice(1)
      .forEach((canvas) =>
        expect(drawn(canvas).filter(({ style }) => style !== theme.colors.primaryDark)).toHaveLength(1)
      );
  });

  it('puts the voices of a stack on its steps, the farthest at the edges', () => {
    // u3 of 12 (1x) at 50 cents: the outer voices an octave up, ±25 cents (edge: 50 + 1200 cents)
    const { set, shape, bars } = setup();
    set({ unison: 3, detune: 50 });
    shape({ stack: '12x1' });
    const x = (cents: number) => MIDDLE + Math.sign(cents) * Math.sqrt(Math.abs(cents) / 1250) * REACH;
    expect(bars().map(({ x }) => x)).toEqual([
      MIDDLE,
      expect.closeTo(x(1175), 6),
      expect.closeTo(x(1225), 6),
    ]);
  });

  it.each([0, 0.5, 0.75, 1])('at a blend of %s has the centre and the others at their levels', (blend) => {
    // u5: each voice as high as its level in its channel (unisonVoices: those of the reference AU)
    const { set, bars } = setup();
    set({ unison: 5, detune: 40, blend });
    const heights = bars().map(({ height, center }) => [center, height]);
    expect(heights).toEqual(
      unisonVoices(5, 40, blend, UNISON_SHAPE).map(({ isCenter, amplitude }) => [
        isCenter,
        expect.closeTo(amplitude * HEIGHT, 6),
      ])
    );
  });

  it('has the middle two voices of an even count as its centre, as high as the chart at most', () => {
    const { set, bars } = setup();
    set({ unison: 4, detune: 30, blend: 0 });
    // (the middle two of u4 at the blend 0 are louder than one voice alone, the others 27 dB under them)
    const [side] = unisonVoices(4, 30, 0, UNISON_SHAPE).map(({ amplitude }) => amplitude);
    expect(bars().map(({ height, center }) => [center, height])).toEqual([
      [false, expect.closeTo(side * HEIGHT, 6)],
      [true, HEIGHT],
      [true, HEIGHT],
      [false, expect.closeTo(side * HEIGHT, 6)],
    ]);
  });

  it('fades out once let go, then is gone', () => {
    jest.useFakeTimers();
    const { show } = setup();
    const overlay = () => screen.queryByTestId('unison-overlay');
    expect(overlay()?.style.opacity).toBe('1');
    show(false);
    expect(overlay()?.style.opacity).toBe('0');
    act(() => {
      jest.advanceTimersByTime(OVERLAY_FADE);
    });
    expect(overlay()).toBeNull();
  });
});
