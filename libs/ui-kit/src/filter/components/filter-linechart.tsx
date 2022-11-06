import React from 'react';
import { scaleLog } from 'd3-scale';
import { curveBasis, line } from 'd3-shape';
import { useLineChartContext } from '../../line-chart';
import { theme } from '../../common/constants';

interface Props {
  data: [number, number][];
}

export const FilterLineChart = ({ data }: Props) => {
  const { width, scaleY } = useLineChartContext();
  const lineFn = React.useMemo(() => {
    const scale = scaleLog().domain([10, 20000]).range([0, width]);
    return line<[number, number]>()
      .x((d) => scale(d[0]))
      .y((d) => scaleY(d[1]))
      .curve(curveBasis);
  }, [scaleY, width]);

  return (
    <g>
      <path
        style={{
          stroke: theme.colors.accent,
          strokeWidth: 1,
          fill: 'transparent',
        }}
        d={lineFn(data) ?? undefined}
      />
    </g>
  );
};
