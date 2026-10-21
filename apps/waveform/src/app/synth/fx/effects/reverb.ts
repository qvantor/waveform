import { mapValues, omit } from 'lodash';
import { FX_PARAMS } from '@waveform/preset-schema';
import { number } from '@waveform/math';
import { REVERB_PROCESSOR } from '../../common/processors';
import { FxDefinition } from './types';
import { ReverbParam, REVERB_PRESETS } from './reverb-presets';
import { formatHz, formatMs, formatSeconds } from './format';
import { eraIndex, REVERB_ERAS } from './reverb-era';
import { ReverbDspParams, ReverbMessage, ReverbOptions } from './reverb-params';
import { createWorkletFx, STEREO_WORKLET_OPTIONS } from './worklet-fx';
import type { FxModMessage } from './fx-modulation';

const { lowcut, pre, size, decay, damp, bass, depth, sep, er, era } = FX_PARAMS.reverb;

// the 16-line feedback delay network runs in an audio worklet (reverb-dsp.ts, reverb.worklet.ts): its
// loops are exact to the sample and the decay gain and shelves of a line change together.
// input → worklet node → output (createWorkletFx); the module loads asynchronously, until then the input
// goes nowhere and the params are kept, the node starts with them
export const reverb: FxDefinition<ReverbParam> = {
  label: 'Reverb',
  params: {
    lowcut: { ...lowcut, label: 'Low cut', mode: 'log', precision: 1, formatValue: formatHz },
    pre: { ...pre, label: 'Predelay', precision: 1000, formatValue: formatMs },
    size: { ...size, label: 'Size', precision: 100, formatValue: number.percent },
    decay: { ...decay, label: 'Decay', mode: 'log', precision: 100, formatValue: formatSeconds },
    damp: { ...damp, label: 'Hi damp', mode: 'log', precision: 1, formatValue: formatHz },
    bass: {
      ...bass,
      label: 'Bass',
      mode: 'log',
      precision: 100,
      formatValue: (value) => `×${value.toFixed(2)}`,
    },
    // the levels are faders, the stereo width fills from its natural 100%
    depth: { ...depth, label: 'Mod', control: 'fader', precision: 100, formatValue: number.percent },
    sep: { ...sep, label: 'Sep', control: 'fader', fillFrom: 1, precision: 100, formatValue: number.percent },
    er: { ...er, label: 'ER', control: 'fader', precision: 100, formatValue: number.percent },
    era: { ...era, label: 'Era', options: REVERB_ERAS },
  },
  presets: REVERB_PRESETS,
  create: (audioCtx) => {
    const values = mapValues(FX_PARAMS.reverb, (param) => param.default);
    let active = true;

    // the era is resolved here, the worklet gets the values of its input stage; null bandwidth: full band
    const eraParams = (value: number) => {
      const { drive, bandwidth, body } = REVERB_ERAS[eraIndex(value)];
      return { drive, bandwidth: bandwidth ?? audioCtx.sampleRate / 2, body };
    };

    // the node starts with the params and the active flag kept until the module has loaded
    const worklet = createWorkletFx(audioCtx, 'reverb', () => {
      const params: ReverbDspParams = { ...omit(values, 'era'), ...eraParams(values.era) };
      const processorOptions: ReverbOptions = { params, active };
      return new AudioWorkletNode(audioCtx, REVERB_PROCESSOR, {
        ...STEREO_WORKLET_OPTIONS,
        processorOptions,
      });
    });
    const post = (message: ReverbMessage) => worklet.post(message);

    return {
      input: worklet.input,
      output: worklet.output,
      $status: worklet.$status,
      retry: worklet.retry,
      // unknown keys are ignored
      setParam: (key, value) => {
        if (!(key in values)) return;
        values[key as ReverbParam] = value;
        post({ params: key === 'era' ? eraParams(value) : { [key]: value } });
      },
      // inactive: the worklet fades the loops out and forgets the tail
      setActive: (value) => {
        active = value;
        post({ active });
      },
      clear: worklet.clear,
      // the worklet moves the knobs once per block, the lines are worked out again only while they move
      setModulation: (mod) => {
        const message: FxModMessage = { mod };
        worklet.post(message);
      },
      destroy: worklet.destroy,
    };
  },
};
