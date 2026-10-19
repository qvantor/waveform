import { render } from '@testing-library/react';
import { PerfHook } from './perf-hook';

describe('perf hook', () => {
  it('is nothing in the app: no element, no api on the window', () => {
    const { container } = render(<PerfHook />);
    expect(container).toBeEmptyDOMElement();
    expect(window.__waveformPerf).toBeUndefined();
  });
});
