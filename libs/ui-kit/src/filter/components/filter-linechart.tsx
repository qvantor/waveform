import React from 'react';
import { affine, useLineChartContext, useLiveLine } from '../../line-chart';
import { theme } from '../../common/constants';
import { LiveKnob, useLiveDraw } from '../../common/utils';
import { responseBuffers, responseInto } from '../services';

interface Props {
  type: BiquadFilterType;
  sampleRate: number;
  // cutoff, resonance and gain
  knobs: LiveKnob[];
  active: boolean;
}

const LINE = { stroke: theme.colors.accent, width: 1 };

// the response line on a canvas over the chart (its overlay), drawn at the knobs (also where their routes move
// them, every frame: useLiveDraw); the line spans the whole width, also when the grid ends below MAX_FREQ (nyquist
// at low sample rates)
export const FilterLineChart = ({ type, sampleRate, knobs, active }: Props) => {
  const { width, padding, scaleY } = useLineChartContext();
  const [canvas, drawLine] = useLiveLine(LINE, 'filter-line');
  const buffers = React.useMemo(responseBuffers, []);
  const scales = React.useMemo(
    () => ({ x: { k: width - padding[0] * 2, b: 0 }, y: affine(scaleY) }),
    [width, padding, scaleY]
  );
  const draw = React.useCallback(
    ([cutoff, resonance, gain]: number[]) => {
      const count = responseInto(type, { cutoff, resonance, gain }, sampleRate, buffers);
      drawLine(count, buffers.xs, buffers.dbs, scales.x, scales.y);
    },
    [type, sampleRate, buffers, scales, drawLine]
  );
  useLiveDraw(knobs, draw, active);
  return canvas;
};
