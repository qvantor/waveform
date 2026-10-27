import React from 'react';
import { line } from 'd3-shape';
import { theme } from '../../common/constants';
import { useLineChartContext } from '../hooks';

type Point = readonly [number, number];

interface Props {
  // values by their index, or [x, y] points in the domains of the chart
  data: number[] | readonly Point[];
  style?: React.CSSProperties;
}

const isValues = (data: Props['data']): data is number[] => typeof data[0] === 'number';

export function Line({ data, style }: Props) {
  const { lineFn, scaleX, scaleY } = useLineChartContext();
  // built again only for new data or scales, not on every render of the chart (a drag over it)
  const d = React.useMemo(
    () =>
      isValues(data)
        ? lineFn(data)
        : line<Point>()
            .x((p) => scaleX(p[0]))
            .y((p) => scaleY(p[1]))(data),
    [lineFn, scaleX, scaleY, data]
  );
  return (
    <g>
      <path
        style={{ stroke: theme.colors.accent, fill: 'transparent', strokeWidth: 2, ...style }}
        d={d ?? undefined}
      />
    </g>
  );
}
