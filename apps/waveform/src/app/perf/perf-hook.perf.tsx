import { useEffect, useRef } from 'react';
import {
  useAdsrEnvelope,
  useInputController,
  useOscillator1,
  useOscillator2,
  useSynth,
  useSynthCore,
} from '../synth/common/modules';
import { useFilter } from '../synth/filter/modules';
import { useFx } from '../synth/fx/modules';
import { usePresets } from '../presets/modules/presets';
import { createPerfApi } from './perf-api';
import type { PerfHook as NoopPerfHook } from './perf-hook';

// the test hook of the perf build (swapped in for perf-hook.tsx by the `perf` configuration): the models of
// the synth on window.__waveformPerf while it is mounted (inside the presets provider: every model is there)
export const PerfHook: typeof NoopPerfHook = () => {
  const models = {
    synthCore: useSynthCore(),
    inputController: useInputController(),
    adsr: useAdsrEnvelope(),
    osc1: useOscillator1(),
    osc2: useOscillator2(),
    filter: useFilter(),
    fx: useFx(),
    synth: useSynth(),
    presets: usePresets(),
  };
  // a provider gives a new [model, actions] at each of its renders, the model and the actions stay (a new model
  // remounts the hook too): the API is built once, from the models at the mount
  const mounted = useRef(models);
  useEffect(() => {
    const api = createPerfApi(mounted.current);
    window.__waveformPerf = api;
    return () => {
      api.destroy();
      delete window.__waveformPerf;
    };
  }, []);
  return null;
};
