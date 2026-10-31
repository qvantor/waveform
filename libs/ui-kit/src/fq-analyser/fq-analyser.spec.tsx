import React from 'react';
import { act, render } from '@testing-library/react';
import { QUIET_MS } from '../common/utils/meter-loop';
import { FqAnalyser } from './index';

const SAMPLE_RATE = 48000;
const BINS = 2048;
const WIDTH = 400;
const HEIGHT = 40;
const BIN_HZ = SAMPLE_RATE / 2 / BINS;
// x of a frequency on the axis: log scale 20..24000 Hz
const xOf = (fq: number) => (WIDTH * Math.log(fq / 20)) / Math.log(SAMPLE_RATE / 2 / 20);

type Spectrum = (data: Uint8Array) => void;
const full: Spectrum = (data) => data.fill(255);
const silence: Spectrum = (data) => data.fill(0);

interface Bar {
  x: number;
  y: number;
  w: number;
  h: number;
}

const setup = ({ active }: { active?: boolean } = {}) => {
  // jsdom has no layout: every element reports the same size
  jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(WIDTH);
  jest.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(HEIGHT);
  const fillRect = jest.fn();
  const clearRect = jest.fn();
  // jsdom has no canvas: getContext returns a stub that records the drawn bars
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    createLinearGradient: () => ({ addColorStop: jest.fn() }),
    clearRect,
    fillRect,
  } as unknown as CanvasRenderingContext2D);
  // keep the scheduled frame to draw it by hand with a timestamp
  let frame: ((time: number) => void) | null = null;
  let now = 1000;
  Object.assign(window, {
    requestAnimationFrame: (callback: (time: number) => void) => {
      frame = callback;
      return 1;
    },
    cancelAnimationFrame: () => {
      frame = null;
    },
  });

  const signal = { spectrum: full };
  const analyser = {
    fftSize: 0,
    maxDecibels: -30,
    frequencyBinCount: BINS,
    getByteFrequencyData: (data: Uint8Array) => signal.spectrum(data),
  };
  const audioCtx = { sampleRate: SAMPLE_RATE, createAnalyser: () => analyser } as unknown as AudioContext;
  const master = { connect: jest.fn(), disconnect: jest.fn() } as unknown as AudioNode;
  const result = render(<FqAnalyser audioCtx={audioCtx} master={master} active={active} />);
  // a frame of a 60 Hz screen: the bars it drew
  const drawFrame = () => {
    fillRect.mockClear();
    now += 1000 / 60;
    const callback = frame;
    frame = null;
    callback?.(now);
    return fillRect.mock.calls.map(([x, y, w, h]) => ({ x, y, w, h } as Bar));
  };
  return {
    ...result,
    analyser,
    master,
    signal,
    clearRect,
    drawFrame,
    scheduled: () => frame !== null,
    rerenderActive: (value: boolean) =>
      result.rerender(<FqAnalyser audioCtx={audioCtx} master={master} active={value} />),
  };
};

const original = {
  requestAnimationFrame: window.requestAnimationFrame,
  cancelAnimationFrame: window.cancelAnimationFrame,
};

afterEach(() => {
  jest.restoreAllMocks();
  Object.assign(window, original);
});

describe('FqAnalyser', () => {
  it('shows only 100, 1k and 10k ticks', () => {
    const { container } = setup();
    const labels = Array.from(container.querySelectorAll('span')).map((span) => span.textContent);
    expect(labels).toEqual(['100', '1k', '10k']);
  });

  it('starts the axis at 20 Hz', () => {
    const { container } = setup();
    const [first] = Array.from(container.querySelectorAll('span')).map((span) =>
      parseFloat((span.parentElement as HTMLElement).style.left)
    );
    expect(first).toBeCloseTo(xOf(100));
  });

  it('draws no bars below 20 Hz and fills the width from 0, column after column', () => {
    const { drawFrame } = setup();
    const bars = drawFrame();
    expect(bars[0].x).toBe(0);
    bars.slice(1).forEach(({ x }, i) => expect(x).toBeCloseTo(bars[i].x + bars[i].w, 9));
    const last = bars[bars.length - 1];
    expect(last.x + last.w).toBeCloseTo(WIDTH);
    expect(bars.every(({ y, h }) => y === HEIGHT && h === -HEIGHT)).toBe(true);
  });

  // a bar per bin was ~2000 rects a frame, most of them narrower than a pixel
  it('draws the bins narrower than a pixel together, a column a pixel wide or more', () => {
    const { drawFrame } = setup();
    const bars = drawFrame();
    expect(bars.length).toBeLessThan(WIDTH);
    // the bins below ~1.3 kHz are wider than a pixel at 400 px: a column each, the first one from 20 Hz
    expect(bars[1]).toMatchObject({
      x: expect.closeTo(xOf(2 * BIN_HZ)),
      w: expect.closeTo(xOf(3 * BIN_HZ) - xOf(2 * BIN_HZ)),
    });
    expect(bars.slice(0, -1).every(({ w }) => w >= 1)).toBe(true);
  });

  it('draws a column as tall as the loudest of its bins', () => {
    const { signal, drawFrame } = setup();
    const loud = 1500;
    signal.spectrum = (data) => {
      data.fill(0);
      data[loud] = 255;
    };
    const bars = drawFrame();
    expect(bars).toHaveLength(1);
    const [{ x, w, h }] = bars;
    expect(h).toBe(-HEIGHT);
    expect(x).toBeLessThanOrEqual(xOf(loud * BIN_HZ) + 1e-9);
    expect(x + w).toBeGreaterThanOrEqual(xOf((loud + 1) * BIN_HZ) - 1e-9);
  });

  it('clears the canvas once when the output goes silent, then draws nothing', () => {
    const { signal, clearRect, drawFrame } = setup();
    drawFrame();
    signal.spectrum = silence;
    clearRect.mockClear();
    expect(drawFrame()).toEqual([]);
    expect(clearRect).toHaveBeenCalledTimes(1);
    drawFrame();
    drawFrame();
    expect(clearRect).toHaveBeenCalledTimes(1);
  });

  it(`sleeps once silent for ${QUIET_MS} ms while no voice sounds, wakes with the next one`, () => {
    const { signal, drawFrame, scheduled, rerenderActive } = setup({ active: false });
    signal.spectrum = silence;
    for (let i = 0; i < (QUIET_MS / 1000) * 60 + 2; i++) drawFrame();
    expect(scheduled()).toBe(false);
    act(() => rerenderActive(true));
    expect(scheduled()).toBe(true);
    signal.spectrum = full;
    expect(drawFrame().length).toBeGreaterThan(0);
  });

  it('keeps drawing while a voice sounds, even in silence', () => {
    const { signal, drawFrame, scheduled } = setup({ active: true });
    signal.spectrum = silence;
    for (let i = 0; i < (QUIET_MS / 1000) * 60 * 2; i++) drawFrame();
    expect(scheduled()).toBe(true);
  });

  // the default top (-30 dB) is reached by a sine at about -16 dBFS, any loud partial looked clipped
  it('shows up to -10 dB, only partials near full scale reach the top', () => {
    const { analyser } = setup();
    expect(analyser.maxDecibels).toBe(-10);
  });

  it('connects the analyser to master, stops drawing and disconnects it on unmount', () => {
    const { master, analyser, scheduled, unmount } = setup();
    expect(master.connect).toHaveBeenCalledWith(analyser);
    unmount();
    expect(master.disconnect).toHaveBeenCalledWith(analyser);
    expect(scheduled()).toBe(false);
  });
});
