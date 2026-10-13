import { FX_PARAMS } from '@waveform/preset-schema';
import { number } from '@waveform/math';
import { FxDefinition } from './types';

const { time, fb } = FX_PARAMS.delay;

// input → delay → output, delay → feedback → delay
export const delay: FxDefinition<'time' | 'fb'> = {
  label: 'Delay',
  params: {
    time: {
      ...time,
      label: 'Time',
      formatValue: (value) => `${Math.round(value * 1000)}ms`,
    },
    fb: {
      ...fb,
      label: 'Feedback',
      precision: 100,
      formatValue: number.percent,
    },
  },
  create: (audioCtx) => {
    const delayNode = audioCtx.createDelay(time.max);
    const feedback = audioCtx.createGain();
    delayNode.connect(feedback);
    feedback.connect(delayNode);
    let fbValue = fb.default;
    let active = true;
    // inactive: no feedback, so the line drains within one delay time instead of ringing on
    const applyFeedback = () =>
      feedback.gain.setTargetAtTime(active ? fbValue : 0, audioCtx.currentTime, 0.01);

    return {
      input: delayNode,
      output: delayNode,
      setParam: (key, value) => {
        if (key === 'time') delayNode.delayTime.setTargetAtTime(value, audioCtx.currentTime, 0.02);
        if (key === 'fb') {
          fbValue = value;
          applyFeedback();
        }
      },
      setActive: (value) => {
        active = value;
        applyFeedback();
      },
      destroy: () => {
        delayNode.disconnect();
        feedback.disconnect();
      },
    };
  },
};
