import { render } from '@testing-library/react';
import { createPerfApi } from './perf-api';
import { PerfHook } from './perf-hook.perf';

// a hook gives a new [model, actions] at each render (as a provider does), of a model and actions that stay (a
// declaration: the mocks are hoisted above the module)
function mockTuple(name: string) {
  const model = { name };
  const actions = { name };
  return () => [model, actions];
}
jest.mock('../synth/common/modules', () => ({
  useSynthCore: mockTuple('synthCore'),
  useInputController: mockTuple('inputController'),
  useAdsrEnvelope: mockTuple('adsr'),
  useOscillator1: mockTuple('osc1'),
  useOscillator2: mockTuple('osc2'),
  useSynth: mockTuple('synth'),
}));
jest.mock('../synth/filter/modules', () => ({ useFilter: mockTuple('filter') }));
jest.mock('../synth/fx/modules', () => ({ useFx: mockTuple('fx') }));
jest.mock('../presets/modules/presets', () => ({ usePresets: mockTuple('presets') }));
jest.mock('./perf-api', () => ({ createPerfApi: jest.fn(() => ({ destroy: jest.fn() })) }));

describe('perf hook of the perf build', () => {
  it('puts the api of the models on the window while mounted', () => {
    const { container, unmount } = render(<PerfHook />);
    expect(container).toBeEmptyDOMElement();
    const [models] = jest.mocked(createPerfApi).mock.calls[0];
    expect(Object.keys(models)).toEqual([
      'synthCore',
      'inputController',
      'adsr',
      'osc1',
      'osc2',
      'filter',
      'fx',
      'synth',
      'presets',
    ]);
    expect(models.fx).toEqual([{ name: 'fx' }, { name: 'fx' }]);
    const api = jest.mocked(createPerfApi).mock.results[0].value;
    expect(window.__waveformPerf).toBe(api);

    unmount();
    expect(api.destroy).toHaveBeenCalled();
    expect(window.__waveformPerf).toBeUndefined();
  });

  it('keeps the api through the renders of the providers', () => {
    const { rerender, unmount } = render(<PerfHook />);
    const api = window.__waveformPerf;
    rerender(<PerfHook />);
    rerender(<PerfHook />);
    expect(createPerfApi).toHaveBeenCalledTimes(1);
    expect(window.__waveformPerf).toBe(api);
    expect(api?.destroy).not.toHaveBeenCalled();
    unmount();
  });
});
