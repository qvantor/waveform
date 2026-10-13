import React from 'react';
import { render } from '@testing-library/react';
import { FilterResponse } from './filter-response';

const WIDTH = 160;
const HEIGHT = 80;

// jsdom has no layout: every observed element reports a fixed size
class ResizeObserverStub {
  constructor(private callback: ResizeObserverCallback) {}
  observe() {
    this.callback(
      [{ contentRect: { width: WIDTH, height: HEIGHT } } as ResizeObserverEntry],
      this as unknown as ResizeObserver
    );
  }
  disconnect() {
    // nothing to release
  }
}

beforeAll(() => {
  Object.assign(globalThis, { ResizeObserver: ResizeObserverStub });
});

const points = (sampleRate: number) => {
  const { container } = render(
    <FilterResponse type='bandpass' cutoff={1000} resonance={1} sampleRate={sampleRate} />
  );
  const d = container.querySelector('path')?.getAttribute('d') ?? '';
  const offset = container.querySelector('svg > g')?.getAttribute('transform');
  const coords = [...d.matchAll(/[ML]([-\d.e]+),([-\d.e]+)/g)].map(([, x, y]) => [Number(x), Number(y)]);
  return { coords, offset };
};

describe('FilterResponse', () => {
  it.each([48000, 32000])('draws the line from the left edge to the right edge at %i Hz', (sampleRate) => {
    const { coords, offset } = points(sampleRate);
    expect(offset).toBe('translate(0, 1)');
    expect(coords[0][0]).toBeCloseTo(0);
    expect(coords[coords.length - 1][0]).toBeCloseTo(WIDTH);
  });

  it('keeps the line inside the chart vertically', () => {
    const { coords } = points(48000);
    coords.forEach(([, y]) => {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(HEIGHT - 2);
    });
  });
});
