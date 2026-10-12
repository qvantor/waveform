import React from 'react';
import { scaleLog } from 'd3-scale';
import { curveLinear, line } from 'd3-shape';
import { useLineChartContext } from '../../line-chart';
import { theme } from '../../common/constants';
import { MAX_FREQ, MIN_FREQ } from '../services';

interface Props {
  data: [number, number][];
}

export const FilterLineChart = ({ data }: Props) => {
  const { width, padding, scaleY } = useLineChartContext();
  const lineFn = React.useMemo(() => {
    const scale = scaleLog()
      .domain([MIN_FREQ, MAX_FREQ])
      .range([0, width - padding[0] * 2]);
    return line<[number, number]>()
      .x((d) => scale(d[0]))
      .y((d) => scaleY(d[1]))
      .curve(curveLinear);
  }, [scaleY, width, padding]);

  return (
    <path
      style={{
        stroke: theme.colors.accent,
        strokeWidth: 1,
        fill: 'transparent',
      }}
      d={lineFn(data) ?? undefined}
    />
  );
};
