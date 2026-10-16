import { mapValues, noop } from 'lodash';
import { FX_PARAMS } from '@waveform/preset-schema';
import { FxDefinition } from './types';
import { DistortionParam, DISTORTION_PRESETS } from './distortion-presets';
import { formatDb, formatHz } from './format';
import { DISTORTION_MODES } from './distortion-modes';
import {
  DISTORTION_LATENCY,
  DISTORTION_PROCESSOR,
  DistortionMessage,
  DistortionOptions,
  TONE_OPEN,
} from './distortion-dsp';
import { createWorkletFx, STEREO_WORKLET_OPTIONS } from './worklet-fx';

const { mode, drive, tone, level } = FX_PARAMS.distortion;

// the oversampled waveshaper runs in an audio worklet (distortion-dsp.ts, distortion.worklet.ts):
// input → worklet node → output (createWorkletFx); the module loads asynchronously, until then the input
// goes nowhere and the params are kept, the node starts with them. Its output lags by DISTORTION_LATENCY,
// the fx slot delays the dry signal as much
export const distortion: FxDefinition<DistortionParam> = {
  label: 'Distortion',
  params: {
    mode: { ...mode, label: 'Mode', options: DISTORTION_MODES },
    drive: { ...drive, label: 'Drive', precision: 10, formatValue: formatDb },
    tone: {
      ...tone,
      label: 'Tone',
      mode: 'log',
      precision: 1,
      formatValue: (value) => (value >= TONE_OPEN ? 'Open' : formatHz(value)),
    },
    level: { ...level, label: 'Level', precision: 10, fillFrom: 0, formatValue: formatDb },
  },
  presets: DISTORTION_PRESETS,
  create: (audioCtx) => {
    const values = mapValues(FX_PARAMS.distortion, (param) => param.default);

    // the node starts with the params kept until the module has loaded
    const worklet = createWorkletFx(audioCtx, 'distortion', () => {
      const processorOptions: DistortionOptions = { params: { ...values } };
      return new AudioWorkletNode(audioCtx, DISTORTION_PROCESSOR, {
        ...STEREO_WORKLET_OPTIONS,
        processorOptions,
      });
    });
    const post = (message: DistortionMessage) => worklet.post(message);

    return {
      input: worklet.input,
      output: worklet.output,
      $status: worklet.$status,
      retry: worklet.retry,
      latency: DISTORTION_LATENCY / audioCtx.sampleRate,
      // unknown keys are ignored
      setParam: (key, value) => {
        if (!(key in values)) return;
        values[key as DistortionParam] = value;
        post({ params: { [key]: value } });
      },
      // no loops to drain: the closed send silences the input, and the worklet idles once it is silent
      setActive: noop,
      destroy: worklet.destroy,
    };
  },
};
