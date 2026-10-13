import React from 'react';
import { render } from '@testing-library/react';
import { FqAnalyser } from './index';

const SAMPLE_RATE = 48000;
const BINS = 2048;
const WIDTH = 400;

const setup = () => {
  // jsdom has no layout: every element reports the same size
  jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(WIDTH);
  jest.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(40);
  const fillRect = jest.fn();
  // jsdom has no canvas: getContext returns a stub that records the drawn bars
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    createLinearGradient: () => ({ addColorStop: jest.fn() }),
    clearRect: jest.fn(),
    fillRect,
  } as unknown as CanvasRenderingContext2D);
  let frame: (() => void) | undefined;
  // jsdom has no requestIdleCallback: keep the frame to draw it by hand
  Object.assign(window, {
    requestIdleCallback: (callback: () => void) => {
      frame = callback;
      return 1;
    },
    cancelIdleCallback: jest.fn(),
  });

  const analyser = {
    fftSize: 0,
    frequencyBinCount: BINS,
    getByteFrequencyData: (data: Uint8Array) => data.fill(255),
  };
  const audioCtx = { sampleRate: SAMPLE_RATE, createAnalyser: () => analyser } as unknown as AudioContext;
  const master = { connect: jest.fn(), disconnect: jest.fn() } as unknown as AudioNode;
  const result = render(<FqAnalyser audioCtx={audioCtx} master={master} />);
  return { ...result, analyser, master, fillRect, drawFrame: () => frame?.() };
};

const original = {
  requestIdleCallback: window.requestIdleCallback,
  cancelIdleCallback: window.cancelIdleCallback,
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
    // log scale 20..24000 Hz
    expect(first).toBeCloseTo((WIDTH * Math.log(100 / 20)) / Math.log(24000 / 20));
  });

  it('draws no bars below 20 Hz and fills the width from 0', () => {
    const { fillRect, drawFrame } = setup();
    drawFrame();
    // the first bin (0..11.7 Hz) is skipped
    expect(fillRect).toHaveBeenCalledTimes(BINS - 1);
    const xs = fillRect.mock.calls.map(([x]) => x as number);
    expect(xs[0]).toBe(0);
    expect(xs.every((x) => x >= 0 && Number.isFinite(x))).toBe(true);
    const [x, , w] = fillRect.mock.calls[BINS - 2];
    expect(x + w).toBeCloseTo(WIDTH);
  });

  it('connects the analyser to master and disconnects it on unmount', () => {
    const { master, analyser, unmount } = setup();
    expect(master.connect).toHaveBeenCalledWith(analyser);
    unmount();
    expect(master.disconnect).toHaveBeenCalledWith(analyser);
  });
});
