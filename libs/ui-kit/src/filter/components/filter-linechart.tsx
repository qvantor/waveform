import React from 'react';
import { scaleLog } from 'd3-scale';
import { curveBasis, line } from 'd3-shape';
import { useLineChartContext } from '../../line-chart';
import { theme } from '../../common/constants';

interface Props {
  data: [number, number][];
  showFQ?: boolean;
}

export const FilterLineChart = ({ data, showFQ = false }: Props) => {
  const { width, scaleY, height, padding } = useLineChartContext();
  const { lineFn, scale } = React.useMemo(() => {
    const scale = scaleLog().domain([10, 20000]).range([0, width]);
    const lineFn = line<[number, number]>()
      .x((d) => scale(d[0]))
      .y((d) => scaleY(d[1]))
      .curve(curveBasis);
    return { lineFn, scale };
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
      {showFQ && (
        <g>
          {[10, 20, 50, 100, 200, 300, 500, 1000, 2000, 3000, 5000, 10000, 15000].map((line) => (
            <g transform={`translate(${scale(line)},0)`} key={line}>
              <line
                style={{ stroke: theme.colors.primaryDarkHighContrast }}
                y1={0}
                y2={height - padding[1] * 2}
              />
              <text transform={`translate(0,5)`} style={{ fill: 'white', fontSize: 8 }}>
                {line}
              </text>
            </g>
          ))}
        </g>
      )}
    </g>
  );
};
